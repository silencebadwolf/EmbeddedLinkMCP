import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlProfileManager } from '@/core/workspace/index.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { runControlWorkflow } from '@/mcp/surfaces/control-workflow/workflow-runner.js';
import { FakeJLinkBackend } from '../../fixtures/fake-jlink-backend.js';

describe('runControlWorkflow known-good compensation callback', () => {
  let root: string;
  let controlProfileManager: ControlProfileManager;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lt-workflow-compensation-'));
    controlProfileManager = new ControlProfileManager();
    sessionManager = new SessionManager();
  });

  afterEach(async () => {
    await sessionManager.destroyAll();
    await rm(root, { recursive: true, force: true });
  });

  it('emits Main-only evidence after flash, verify, and RTT observation succeed', async () => {
    const firmware = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    await writeFile(path.join(root, 'rtthread.bin'), firmware);
    await controlProfileManager.init(root, {
      jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
      flash: { binary: 'rtthread.bin', baseAddress: '0x08008000', verify: true },
      rtt: { enabled: true, channels: [0] },
    });
    const recorder = vi.fn();

    const data = await runControlWorkflow(
      {
        controlProfileManager,
        sessionManager,
        jlinkBackend: new FakeJLinkBackend(),
        openSerial: vi.fn(),
      },
      {
        root,
        mode: 'flash-observe',
        observe: { markers: ['hello-rtt'], timeoutMs: 50 },
        confirm: true,
      },
      { onVerifiedDeployment: recorder },
    );

    expect(data.failedStep).toBeUndefined();
    expect(recorder).toHaveBeenCalledTimes(1);
    expect(recorder).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceOperationId: expect.stringMatching(/^workflow_/),
        targetLabel: 'AT32F435RGT7',
        targetBindingDigest: expect.stringMatching(/^sha256:/),
        profileRevision: expect.stringMatching(/^sha256:/),
        workflowMode: 'flash-observe',
        manifestDigest: expect.stringMatching(/^sha256:/),
        firmware: expect.objectContaining({
          mainOwnedSourceRef: expect.stringContaining('rtthread.bin'),
          displayName: 'rtthread.bin',
          contentSha256: createHash('sha256').update(firmware).digest('hex'),
          byteLength: 4,
          format: 'bin',
          baseAddress: 0x08008000,
        }),
        result: {
          flashed: true,
          verified: true,
          observationSucceeded: true,
        },
      }),
    );
  });

  it('does not emit known-good evidence for RTT-silent failed workflows', async () => {
    class SilentRttBackend extends FakeJLinkBackend {
      override async rttRead(
        probeId: string,
        channelIndex: number,
        maxBytes: number,
      ): Promise<{ data: Buffer; channelIndex: number; truncated: boolean }> {
        this.calls.push({ method: 'rttRead', args: [probeId, channelIndex, maxBytes] });
        return { data: Buffer.alloc(0), channelIndex, truncated: false };
      }
    }
    await writeFile(path.join(root, 'rtthread.bin'), Buffer.from([0x01, 0x02, 0x03, 0x04]));
    await controlProfileManager.init(root, {
      jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
      flash: { binary: 'rtthread.bin', baseAddress: '0x08008000', verify: true },
      rtt: { enabled: true, channels: [0] },
    });
    const recorder = vi.fn();

    const data = await runControlWorkflow(
      {
        controlProfileManager,
        sessionManager,
        jlinkBackend: new SilentRttBackend(),
        openSerial: vi.fn(),
      },
      {
        root,
        mode: 'flash-observe',
        observe: { markers: ['never-arrives'], timeoutMs: 20 },
        confirm: true,
      },
      { onVerifiedDeployment: recorder },
    );

    expect(data.failedStep).toBe('observe_rtt');
    expect(recorder).not.toHaveBeenCalled();
  });
});

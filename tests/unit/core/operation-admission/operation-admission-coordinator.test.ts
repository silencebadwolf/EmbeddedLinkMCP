import { describe, expect, it, vi } from 'vitest';

import {
  OperationAdmissionCoordinator,
  type OperationAdmissionRequest,
} from '@/core/operation-admission/operation-admission-coordinator.js';

function createCoordinator() {
  return new OperationAdmissionCoordinator({
    runtimeId: 'runtime_1',
    now: () => '2026-07-14T00:00:01.000Z',
  });
}

function aiWriteRequest(overrides: Partial<OperationAdmissionRequest> = {}): OperationAdmissionRequest {
  return {
    operationId: 'operation_1',
    principalId: 'ai:test',
    origin: 'ai',
    mode: 'state-affecting',
    revalidate: async () => ({ ok: true }),
    consumeApproval: async () => ({ ok: true }),
    ...overrides,
  };
}

describe('operation admission coordinator', () => {
  it('does not invoke a legacy approval callback for AI state-affecting operations', async () => {
    const coordinator = createCoordinator();
    const effectful = vi.fn();
    const consumeApproval = vi.fn(async () => ({ ok: true as const }));

    const result = await coordinator.withAdmission(
      aiWriteRequest({ consumeApproval }),
      async () => {
        effectful();
        return 'executed';
      },
    );

    expect(result).toMatchObject({ ok: true, value: 'executed' });
    expect(consumeApproval).not.toHaveBeenCalled();
    expect(effectful).toHaveBeenCalledOnce();
  });

  it('allows read-only AI and human operations while paused', async () => {
    const coordinator = createCoordinator();

    await expect(
      coordinator.withAdmission(
        aiWriteRequest({
          operationId: 'read_1',
          mode: 'read-only',
          consumeApproval: undefined,
        }),
        async () => 'read',
      ),
    ).resolves.toMatchObject({ ok: true, value: 'read' });

    await expect(
      coordinator.withAdmission(
        aiWriteRequest({
          operationId: 'human_1',
          principalId: 'human:test',
          origin: 'human',
          consumeApproval: undefined,
        }),
        async () => 'human',
      ),
    ).resolves.toMatchObject({ ok: true, value: 'human' });
  });

  it('acquires a main-only lease before effectful callbacks and releases it idempotently', async () => {
    const coordinator = createCoordinator();
    let activeLeaseCount = -1;

    const result = await coordinator.withAdmission(aiWriteRequest(), async ({ lease }) => {
      activeLeaseCount = coordinator.getActiveLeaseCount();
      expect(JSON.stringify(lease)).toMatch(/leaseId/);
      expect(JSON.stringify(lease)).toMatch(/principalId/);
      return 'executed';
    });

    expect(result).toMatchObject({ ok: true, value: 'executed' });
    expect(activeLeaseCount).toBe(1);
    expect(coordinator.getActiveLeaseCount()).toBe(0);
    coordinator.releaseLease(undefined);
    expect(coordinator.getActiveLeaseCount()).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/leaseId|principalId/);
  });

  it('invalidates leases on runtime restart', async () => {
    const coordinator = createCoordinator();
    let capturedLease: unknown;

    await coordinator.withAdmission(aiWriteRequest(), async ({ lease }) => {
      capturedLease = lease;
      coordinator.restartRuntime('runtime_2');
      return 'after-restart';
    });

    coordinator.releaseLease(capturedLease);
    expect(coordinator.getActiveLeaseCount()).toBe(0);
  });

  it('runs revalidation directly before the effectful callback', async () => {
    const coordinator = createCoordinator();
    const order: string[] = [];

    const result = await coordinator.withAdmission(
      aiWriteRequest({
        revalidate: async () => {
          order.push('revalidate');
          return { ok: true };
        },
        consumeApproval: async () => {
          order.push('consume');
          return { ok: true };
        },
      }),
      async () => {
        order.push('effect');
        return 'executed';
      },
    );

    expect(result).toMatchObject({ ok: true, value: 'executed' });
    expect(order).toEqual(['revalidate', 'effect']);
  });

  it('does not wait for or re-check a retired approval latch', async () => {
    const coordinator = createCoordinator();
    const effectful = vi.fn();
    const order: string[] = [];

    const result = await coordinator.withAdmission(
      aiWriteRequest({
        consumeApproval: async () => {
          order.push('consume');
          return { ok: true };
        },
      }),
      async () => {
        order.push('effect');
        effectful();
        return 'executed';
      },
    );

    expect(result).toMatchObject({ ok: true, value: 'executed' });
    expect(order).toEqual(['effect']);
    expect(effectful).toHaveBeenCalledOnce();
    expect(coordinator.getActiveLeaseCount()).toBe(0);
  });
});

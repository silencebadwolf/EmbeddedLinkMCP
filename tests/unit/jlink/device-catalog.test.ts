import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJLinkDeviceCatalog } from '@/jlink/device-catalog.js';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = path.join(os.tmpdir(), `linkterm-jlink-catalog-${Date.now()}-${Math.random()}`);
  await mkdir(root, { recursive: true });
  roots.push(root);
  return root;
}

async function writeXml(root: string, relativePath: string, text: string): Promise<string> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, 'utf-8');
  return filePath;
}

describe('JLinkDeviceCatalog', () => {
  let root: string;

  beforeEach(async () => {
    root = await tempRoot();
  });

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('parses SEGGER XML device names, vendor/core, script, and flash banks', async () => {
    await writeXml(root, 'JLinkDevices.xml', `
      <DataBase>
        <Device>
          <ChipInfo Name="-AT32F435RGT7" Vendor="ArteryTek" Core="JLINK_CORE_CORTEX_M4" JLinkScriptFile="Devices/ArteryTek/AT32F4xx.JLinkScript"/>
          <FlashBankInfo Name="Flash Bank1" BaseAddr="0x08000000" MaxSize="0x00100000" Loader="Devices/ArteryTek/AT32FLM/AT32F435_1024.FLM"/>
        </Device>
        <Device>
          <ChipInfo Name="STM32H743II" Vendor="ST" Core="JLINK_CORE_CORTEX_M7"/>
        </Device>
      </DataBase>
    `);
    const catalog = createJLinkDeviceCatalog({ installRoots: [root] });

    const result = await catalog.search({ query: 'AT32F435', limit: 5 });

    expect(result.available).toBe(true);
    expect(result.devices[0]).toMatchObject({
      name: '-AT32F435RGT7',
      vendor: 'ArteryTek',
      core: 'JLINK_CORE_CORTEX_M4',
      jlinkScriptFile: 'Devices/ArteryTek/AT32F4xx.JLinkScript',
      flashBanks: [
        {
          name: 'Flash Bank1',
          baseAddress: '0x08000000',
          maxSize: '0x00100000',
          loader: 'Devices/ArteryTek/AT32FLM/AT32F435_1024.FLM',
        },
      ],
    });
    expect(result.sourceFiles).toEqual([path.join(root, 'JLinkDevices.xml')]);
  });

  it('searches AddOn Devices XML files and ranks exact/prefix matches first', async () => {
    await writeXml(root, 'JLinkDevices.xml', '<DataBase><Device><ChipInfo Name="STM32F407VG" Vendor="ST"/></Device></DataBase>');
    await writeXml(root, 'Devices/Vendor/Pack.xml', '<DataBase><Device><ChipInfo Name="-AT32F435RGT7" Vendor="ArteryTek"/></Device></DataBase>');
    const catalog = createJLinkDeviceCatalog({ installRoots: [root] });

    const result = await catalog.search({ query: 'AT32F435RGT7', limit: 10 });

    expect(result.devices.map((d) => d.name)[0]).toBe('-AT32F435RGT7');
  });

  it('normalizes STM32 order-code query only for suggestions and preserves registered catalog names', async () => {
    await writeXml(root, 'JLinkDevices.xml', '<DataBase><Device><ChipInfo Name="STM32H743II" Vendor="ST"/></Device></DataBase>');
    const catalog = createJLinkDeviceCatalog({ installRoots: [root] });

    const result = await catalog.search({ query: 'STM32H743IIT6', limit: 5 });

    expect(result.devices[0]?.name).toBe('STM32H743II');
    expect(result.queryNormalization).toEqual({ originalQuery: 'STM32H743IIT6', normalizedQuery: 'STM32H743II' });
  });

  it('parses exported J-Link internal DeviceDatabase entries and aliases', async () => {
    const internalXml = await writeXml(root, 'ExportedInternalDevices.xml', `
      <DeviceDatabase>
        <VendorInfo Name="ST">
          <DeviceInfo Name="STM32H743II" Core="JLINK_CORE_CORTEX_M7">
            <AliasInfo Name="STM32H743IIT6" />
          </DeviceInfo>
          <DeviceInfo Name="STM32F407VG" Core="JLINK_CORE_CORTEX_M4" />
        </VendorInfo>
      </DeviceDatabase>
    `);
    const catalog = createJLinkDeviceCatalog({ installRoots: [root], internalDeviceListXmlPath: internalXml } as never);

    const stm32 = await catalog.search({ query: 'STM32', limit: 10 });
    const orderCode = await catalog.search({ query: 'STM32H743IIT6', limit: 5 });

    expect(stm32.devices.map((device) => device.name)).toEqual(['STM32F407VG', 'STM32H743II']);
    expect(orderCode.devices[0]).toMatchObject({
      name: 'STM32H743II',
      vendor: 'ST',
      core: 'JLINK_CORE_CORTEX_M7',
      aliases: ['STM32H743IIT6'],
      sourceFile: internalXml,
    });
  });

  it('searches aliases from generic core entries in Commander internal exports', async () => {
    const internalXml = await writeXml(root, 'ExportedInternalDevices.xml', `
      <DeviceDatabase>
        <VendorInfo Name="Unspecified" >
          <DeviceInfo Name="Cortex-M7" Core="Cortex-M7" >
            <AliasInfo Name="STM32H743II" />
            <AliasInfo Name="STM32H743IIT6" />
          </DeviceInfo>
        </VendorInfo>
      </DeviceDatabase>
    `);
    const catalog = createJLinkDeviceCatalog({ installRoots: [root], internalDeviceListXmlPath: internalXml } as never);

    const result = await catalog.search({ query: 'STM32H743IIT6', limit: 5 });

    expect(result.devices[0]).toMatchObject({
      name: 'Cortex-M7',
      aliases: ['STM32H743II', 'STM32H743IIT6'],
    });
  });

  it('accepts whitespace in SEGGER exported closing tags', async () => {
    const internalXml = await writeXml(root, 'ExportedInternalDevices.xml', `
      <DeviceDatabase>
        <VendorInfo Name="ST" >
          <DeviceInfo Name="STM32H743II" Core="Cortex-M7" >
            <AliasInfo Name="STM32H743IITx" />
          </DeviceInfo >
        </VendorInfo >
      </DeviceDatabase>
    `);
    const catalog = createJLinkDeviceCatalog({ installRoots: [root], internalDeviceListXmlPath: internalXml } as never);

    const result = await catalog.search({ query: 'STM32H743II', limit: 5 });

    expect(result.devices[0]?.name).toBe('STM32H743II');
  });

  it('ranks matching device names before generic core entries that only match aliases', async () => {
    const internalXml = await writeXml(root, 'ExportedInternalDevices.xml', `
      <DeviceDatabase>
        <VendorInfo Name="Unspecified" >
          <DeviceInfo Name="Cortex-M4" Core="Cortex-M4" >
            <AliasInfo Name="STM32F410x" />
          </DeviceInfo >
          <DeviceInfo Name="STM32H743II" Core="Cortex-M7" />
        </VendorInfo >
      </DeviceDatabase>
    `);
    const catalog = createJLinkDeviceCatalog({ installRoots: [root], internalDeviceListXmlPath: internalXml } as never);

    const result = await catalog.search({ query: 'STM32', limit: 5 });

    expect(result.devices.map((device) => device.name)).toEqual(['STM32H743II', 'Cortex-M4']);
  });

  it('uses a cached Commander ExpDevListXML export as a device source', async () => {
    const commanderPath = path.join(root, process.platform === 'win32' ? 'JLink.exe' : 'JLinkExe');
    const cacheRoot = path.join(root, 'cache');
    await writeFile(commanderPath, '', 'utf-8');
    await writeXml(root, 'JLinkDevices.xml', '<DataBase></DataBase>');
    const exportCalls: string[] = [];
    const catalog = createJLinkDeviceCatalog({
      installRoots: [root],
      commanderPath,
      cacheRoot,
      internalDeviceListExporter: async ({ outputPath }: { outputPath: string }) => {
        exportCalls.push(outputPath);
        await writeFile(outputPath, `
          <DeviceDatabase>
            <VendorInfo Name="ST">
              <DeviceInfo Name="STM32H743II" Core="JLINK_CORE_CORTEX_M7" />
            </VendorInfo>
          </DeviceDatabase>
        `, 'utf-8');
        return true;
      },
    } as never);

    const first = await catalog.search({ query: 'STM32H743II', limit: 5 });
    const second = await catalog.search({ query: 'STM32H743II', limit: 5 });

    expect(first.devices[0]?.name).toBe('STM32H743II');
    expect(second.devices[0]?.name).toBe('STM32H743II');
    expect(exportCalls).toHaveLength(1);
    expect(first.sourceFiles).toContain(exportCalls[0]);
  });

  it('returns unavailable instead of throwing when no SEGGER database exists', async () => {
    const catalog = createJLinkDeviceCatalog({ installRoots: [root] });

    const result = await catalog.search({ query: 'STM32', limit: 5 });

    expect(result.available).toBe(false);
    expect(result.devices).toEqual([]);
    expect(result.reason).toBe('database-not-found');
  });

  it('refreshes cache when source mtime changes', async () => {
    const xml = await writeXml(root, 'JLinkDevices.xml', '<DataBase><Device><ChipInfo Name="STM32F407VG" Vendor="ST"/></Device></DataBase>');
    const catalog = createJLinkDeviceCatalog({ installRoots: [root] });
    expect((await catalog.get('STM32F407VG'))?.name).toBe('STM32F407VG');
    await writeFile(xml, '<DataBase><Device><ChipInfo Name="STM32H743II" Vendor="ST"/></Device></DataBase>', 'utf-8');
    const now = new Date(Date.now() + 2000);
    await utimes(xml, now, now);

    await catalog.refresh();

    expect(await catalog.get('STM32F407VG')).toBeUndefined();
    expect((await catalog.get('STM32H743II'))?.name).toBe('STM32H743II');
  });
});

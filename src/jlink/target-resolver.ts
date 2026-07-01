import type { JLinkDeviceCatalog, JLinkDeviceInfo } from './device-catalog.js';
import { classifyJLinkTargetName } from '../shared/jlink-target-name.js';

export interface JLinkTargetResolutionWarning {
  kind: 'jlink_target_not_in_catalog';
  target: string;
  originalTarget: string;
  message: string;
  suggestions: JLinkDeviceInfo[];
}

export interface JLinkTargetResolution {
  target: string;
  originalTarget: string;
  normalization?: {
    originalTarget: string;
    normalizedTarget: string;
    kind: 'stm32-order-code';
    message?: string;
  };
  catalog?: {
    available: boolean;
    matched: boolean;
    sourceFiles: string[];
    suggestions: JLinkDeviceInfo[];
  };
  warnings: JLinkTargetResolutionWarning[];
}

export async function resolveJLinkTarget(
  rawTarget: string,
  catalog?: JLinkDeviceCatalog,
): Promise<JLinkTargetResolution> {
  const classification = classifyJLinkTargetName(rawTarget);
  const result: JLinkTargetResolution = {
    target: classification.normalizedTarget,
    originalTarget: classification.originalTarget,
    warnings: [],
  };

  if (classification.kind === 'stm32-order-code') {
    result.normalization = {
      originalTarget: classification.originalTarget,
      normalizedTarget: classification.normalizedTarget,
      kind: classification.kind,
      ...(classification.message !== undefined ? { message: classification.message } : {}),
    };
  }
  if (catalog === undefined) return result;

  const search = await catalog.search({ query: classification.normalizedTarget, limit: 5 });
  if (!search.available) {
    result.catalog = { available: false, matched: false, sourceFiles: [], suggestions: [] };
    return result;
  }

  const matched = await catalog.has(classification.normalizedTarget);
  result.catalog = {
    available: true,
    matched,
    sourceFiles: search.sourceFiles,
    suggestions: search.devices,
  };
  if (!matched) {
    result.warnings.push({
      kind: 'jlink_target_not_in_catalog',
      target: classification.normalizedTarget,
      originalTarget: classification.originalTarget,
      message:
        `J-Link target ${classification.normalizedTarget} was not found in the local SEGGER device catalog; ` +
        'LinkTerm will still try the target because another installed SEGGER pack may support it.',
      suggestions: search.devices,
    });
  }
  return result;
}

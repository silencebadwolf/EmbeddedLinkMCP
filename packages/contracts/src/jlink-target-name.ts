export type JLinkTargetNameKind = 'segger-target' | 'stm32-order-code';

export interface JLinkTargetNameClassification {
  kind: JLinkTargetNameKind;
  originalTarget: string;
  normalizedTarget: string;
  suggestedTarget?: string;
  message?: string;
}

/**
 * Return a SEGGER/J-Link device-name suggestion for common vendor order-code strings.
 */
export function suggestJLinkTargetName(target: string): string | undefined {
  return suggestStm32SeggerTargetName(target);
}

/**
 * Normalize a target token before it reaches SEGGER tools.
 */
export function normalizeJLinkTargetName(target: string): string {
  const trimmed = target.trim();
  return suggestJLinkTargetName(trimmed) ?? trimmed;
}

/**
 * Classify a target token and keep enough evidence for UI/MCP diagnostics.
 */
export function classifyJLinkTargetName(target: string): JLinkTargetNameClassification {
  const originalTarget = target.trim();
  const suggestedTarget = suggestJLinkTargetName(originalTarget);
  if (suggestedTarget !== undefined) {
    return {
      kind: 'stm32-order-code',
      originalTarget,
      normalizedTarget: suggestedTarget,
      suggestedTarget,
      message:
        `${originalTarget} looks like a full STM32 order code. ` +
        `SEGGER/J-Link device names omit the package/temperature/order suffix; using ${suggestedTarget}.`,
    };
  }
  return {
    kind: 'segger-target',
    originalTarget,
    normalizedTarget: originalTarget,
  };
}

function suggestStm32SeggerTargetName(target: string): string | undefined {
  const text = target.trim().toUpperCase();
  const match = text.match(/^(STM32[A-Z0-9]+[A-Z]{2})([A-Z][0-9])(?:TR)?$/u);
  if (!match) return undefined;
  const suggested = match[1]!;
  return suggested === text ? undefined : suggested;
}

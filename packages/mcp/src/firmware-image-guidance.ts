/** Shared AI-facing guidance for firmware image handling. */

export const FIRMWARE_IMAGE_FORMATS = '.bin/.hex/.elf';

export const FIRMWARE_IMAGE_USAGE_GUIDANCE =
  'Firmware formats .bin/.hex/.elf are supported. LinkTerm treats .bin as raw bytes, decodes .hex records, and decodes ELF loadable segments from ELF loadable program segments before raw flash download; it must not treat the ELF file header as a raw Cortex-M vector table. If ELF/base/vector diagnostics fail, fix profile.flash.baseAddress or the ELF image; do not change the profile firmware from .elf to .bin, do not rewrite the profile to a .bin file, and do not override an .elf profile with a .bin path.';

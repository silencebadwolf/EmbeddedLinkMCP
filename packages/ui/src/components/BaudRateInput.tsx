import * as React from 'react';
import { Input } from './ui/input.js';
import { useT } from '../i18n/index.js';

const COMMON_BAUD_RATES = [
  '9600',
  '19200',
  '38400',
  '57600',
  '115200',
  '230400',
  '460800',
  '921600',
  '1000000',
  '2000000',
] as const;

export interface BaudRateInputProps {
  id: string;
  value: string;
  onChange(value: string): void;
}

/**
 * 可手填的波特率输入框，并提供常用波特率快捷选择。
 *
 * @param props 受控输入属性
 * @returns 波特率输入 UI
 */
export function BaudRateInput({ id, value, onChange }: BaudRateInputProps): React.ReactElement {
  const t = useT();
  const [open, setOpen] = React.useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        className="pr-10"
      />
      <button
        type="button"
        aria-label={t('dialog.serial.commonBaudRates')}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md border-l border-gray-700 text-xs text-gray-300 hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onClick={() => setOpen((prev) => !prev)}
      >
        v
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={t('dialog.serial.baudRate')}
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-700 bg-gray-900 p-1 text-sm text-gray-100 shadow-lg"
        >
          {COMMON_BAUD_RATES.map((rate) => (
            <button
              key={rate}
              type="button"
              role="option"
              aria-selected={value === rate}
              className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-gray-800 aria-selected:bg-blue-600"
              onClick={() => {
                onChange(rate);
                setOpen(false);
              }}
            >
              {rate}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

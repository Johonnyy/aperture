import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Compose class names, letting a later one win over an earlier one.
 *
 * Replaces the `[...].join(' ')` pattern the app grew up with. That worked while
 * class lists were short, but it has no idea two entries conflict — `'px-4'` and a
 * conditional `'px-2'` both end up in the string and which one applies is down to
 * the order Tailwind happened to emit them, not the order they were written.
 * `twMerge` resolves that properly, which is what makes variant props safe.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

'use client';

import { useId } from 'react';
import { BadgeCheck } from 'lucide-react';
import { useContactResolver } from '@/hooks/useAddressBook';
import { contactDisplayName, resolveAddressInput } from '@/lib/addressBook';

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  labelClassName?: string;
}

/**
 * Address field that suggests trusted contacts and shows who an entered key
 * belongs to. Accepts a public key or the exact name of a contact; resolve the
 * value on submit with `resolveAddressInput`.
 */
export default function ContactAddressInput({
  id,
  label,
  value,
  onChange,
  placeholder = 'Stellar address (G…) or contact name',
  className = '',
  labelClassName = 'sr-only',
}: Props) {
  const listId = useId();
  const hintId = useId();
  const { contacts, resolve } = useContactResolver();

  const typed = value.trim();
  const resolvedKey = typed ? resolveAddressInput(typed, contacts) : null;
  const contact = resolve(resolvedKey);

  return (
    <div className="flex-1 min-w-0">
      <label htmlFor={id} className={labelClassName}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={contacts.length ? listId : undefined}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-describedby={typed ? hintId : undefined}
        className={
          className ||
          'w-full rounded-md border border-border bg-surface-inset px-3 py-2 text-xs text-text-1 focus:outline-none focus:ring-2 focus:ring-border-focus'
        }
      />
      {contacts.length > 0 && (
        <datalist id={listId}>
          {contacts.map((c) => (
            <option key={c.id} value={c.publicKey}>
              {contactDisplayName(c)}
            </option>
          ))}
        </datalist>
      )}
      {typed && (
        <p id={hintId} className="mt-1 text-2xs text-text-3" aria-live="polite">
          {contact ? (
            <span className="inline-flex items-center gap-1 text-text-2">
              {contactDisplayName(contact)}
              {contact.verified ? (
                <>
                  <BadgeCheck className="w-3 h-3" style={{ color: '#00C896' }} /> verified provider
                </>
              ) : (
                ' · unverified contact'
              )}
            </span>
          ) : resolvedKey ? (
            'Not in your trusted contacts. Double-check this address.'
          ) : (
            'Enter a Stellar address or the exact name of a trusted contact.'
          )}
        </p>
      )}
    </div>
  );
}

import { runInNewContext } from 'node:vm';
import { FRAME_BUSTING_SCRIPT } from '@/lib/frameBusting';

const HELIORA_URL = 'https://heliora.example/appointments';

interface TestEnvironment {
  replace: jest.Mock;
  document: {
    documentElement: { style: { display: string } };
    body: { replaceChildren: jest.Mock };
    addEventListener: jest.Mock;
  };
  domReadyHandlers: Array<() => void>;
  timers: Array<() => void>;
}

function setup(framed: boolean, redirectThrows = false): TestEnvironment {
  const replace = jest.fn(() => {
    if (redirectThrows) {
      throw new Error('top navigation blocked');
    }
  });
  const selfWindow = { location: { href: HELIORA_URL } };
  const topWindow = framed ? { location: { replace } } : selfWindow;
  const window = { location: selfWindow.location, self: selfWindow, top: topWindow };
  const domReadyHandlers: Array<() => void> = [];
  const timers: Array<() => void> = [];
  const document = {
    documentElement: { style: { display: '' } },
    body: { replaceChildren: jest.fn() },
    addEventListener: jest.fn((_event: string, handler: () => void) => {
      domReadyHandlers.push(handler);
    }),
  };

  runInNewContext(FRAME_BUSTING_SCRIPT, {
    window,
    document,
    setTimeout: (handler: () => void) => {
      timers.push(handler);
      return timers.length;
    },
  });

  return { replace, document, domReadyHandlers, timers };
}

describe('client-side framebusting', () => {
  it('leaves top-level documents untouched', () => {
    const env = setup(false);

    expect(env.replace).not.toHaveBeenCalled();
    expect(env.document.documentElement.style.display).toBe('');
    expect(env.document.addEventListener).not.toHaveBeenCalled();
  });

  it('breaks out of a framed payment flow and removes its UI', () => {
    const env = setup(true);

    expect(env.replace).toHaveBeenCalledWith(HELIORA_URL);
    expect(env.document.documentElement.style.display).toBe('none');
    expect(env.document.addEventListener).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function));

    env.domReadyHandlers.forEach((handler) => handler());
    expect(env.document.body.replaceChildren).toHaveBeenCalledTimes(1);
  });

  it('still hides the document when top navigation is blocked', () => {
    const env = setup(true, true);

    expect(env.replace).toHaveBeenCalledWith(HELIORA_URL);
    expect(env.document.documentElement.style.display).toBe('none');
  });

  it('keeps the document hidden on the deferred check without duplicating handlers', () => {
    const env = setup(true);

    env.timers.forEach((handler) => handler());

    expect(env.replace).toHaveBeenCalledTimes(1);
    expect(env.document.addEventListener).toHaveBeenCalledTimes(1);
    expect(env.document.documentElement.style.display).toBe('none');
  });
});

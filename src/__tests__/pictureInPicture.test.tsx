import { render, screen, fireEvent } from '@testing-library/react';
import PictureInPictureVideo from '@/components/consultation/PictureInPictureVideo';
import {
  canVideoEnterPictureInPicture,
  isPictureInPictureAvailable,
  toggleVideoPictureInPicture,
} from '@/lib/video';

function createDoc(
  overrides: { pictureInPictureEnabled?: boolean; pictureInPictureElement?: unknown } = {},
): Document {
  return {
    pictureInPictureEnabled: true,
    pictureInPictureElement: null,
    exitPictureInPicture: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Document;
}

function createVideo(withPiPApi = true): HTMLVideoElement {
  const video: Partial<HTMLVideoElement> = { muted: false };
  if (withPiPApi) {
    video.requestPictureInPicture = jest.fn().mockResolvedValue({});
  }
  return video as HTMLVideoElement;
}

describe('feat(video): picture-in-picture capability detection and toggle (#265)', () => {
  describe('isPictureInPictureAvailable', () => {
    it('reports Picture-in-Picture as available only when the document enables it', () => {
      expect(isPictureInPictureAvailable(createDoc())).toBe(true);
      expect(isPictureInPictureAvailable(createDoc({ pictureInPictureEnabled: false }))).toBe(false);
    });

    it('treats a browser without the Picture-in-Picture API as unsupported', () => {
      expect(isPictureInPictureAvailable({} as Document)).toBe(false);
    });
  });

  describe('canVideoEnterPictureInPicture', () => {
    it('keeps the control hidden when requestPictureInPicture is absent', () => {
      expect(canVideoEnterPictureInPicture(createVideo(false), createDoc())).toBe(false);
    });

    it('returns false for a missing element or a disabled document', () => {
      expect(canVideoEnterPictureInPicture(null, createDoc())).toBe(false);
      expect(
        canVideoEnterPictureInPicture(createVideo(true), createDoc({ pictureInPictureEnabled: false })),
      ).toBe(false);
    });

    it('returns true when the element and document both support Picture-in-Picture', () => {
      expect(canVideoEnterPictureInPicture(createVideo(true), createDoc())).toBe(true);
    });
  });

  describe('toggleVideoPictureInPicture', () => {
    it('requests Picture-in-Picture without muting the element, so call audio keeps playing', async () => {
      const video = createVideo();
      const doc = createDoc();

      await expect(toggleVideoPictureInPicture(video, doc)).resolves.toBe(true);
      expect(video.requestPictureInPicture).toHaveBeenCalledTimes(1);
      expect(video.muted).toBe(false);
      expect(doc.exitPictureInPicture).not.toHaveBeenCalled();
    });

    it('exits Picture-in-Picture when this element is the active one', async () => {
      const video = createVideo();
      const doc = createDoc({ pictureInPictureElement: video });

      await expect(toggleVideoPictureInPicture(video, doc)).resolves.toBe(false);
      expect(doc.exitPictureInPicture).toHaveBeenCalledTimes(1);
      expect(video.requestPictureInPicture).not.toHaveBeenCalled();
    });

    it('propagates browser refusals so callers can fall back', async () => {
      const video = createVideo();
      video.requestPictureInPicture = jest.fn().mockRejectedValue(new Error('NotAllowedError'));

      await expect(toggleVideoPictureInPicture(video, createDoc())).rejects.toThrow('NotAllowedError');
    });
  });

  describe('PictureInPictureVideo control', () => {
    it('hides the Picture-in-Picture control when the browser has no PiP API', () => {
      const { container } = render(
        <PictureInPictureVideo stream={{} as MediaStream} isMinimized={false} onToggleMinimize={jest.fn()} />,
      );

      expect(container.querySelector('video')).not.toBeNull();
      expect(screen.queryByRole('button', { name: 'Picture-in-Picture' })).not.toBeInTheDocument();
    });

    it('shows the control, then the active badge, once Picture-in-Picture starts', async () => {
      Object.defineProperty(document, 'pictureInPictureEnabled', { value: true, configurable: true });
      HTMLVideoElement.prototype.requestPictureInPicture = jest.fn().mockResolvedValue({});

      try {
        render(
          <PictureInPictureVideo stream={{} as MediaStream} isMinimized={false} onToggleMinimize={jest.fn()} />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Picture-in-Picture' }));

        expect(await screen.findByRole('button', { name: 'Exit PiP' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('PiP active');
      } finally {
        delete (document as { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled;
        delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).requestPictureInPicture;
      }
    });
  });
});

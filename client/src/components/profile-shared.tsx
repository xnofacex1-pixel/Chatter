import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { api, ApiError, type User } from '../lib/api';
import { useToast } from '../components/Toast';
import { describeError } from '../lib/validation';

export const ACCENTS = [
  { id: 'violet', label: 'Chatter violet', value: '#7655f5' },
  { id: 'blue', label: 'Electric blue', value: '#3b82f6' },
  { id: 'cyan', label: 'Neon cyan', value: '#22d3ee' },
  { id: 'emerald', label: 'Emerald', value: '#10b981' },
  { id: 'rose', label: 'Rose', value: '#f43f5e' },
  { id: 'amber', label: 'Amber', value: '#f59e0b' },
] as const;

export const BANNERS = ['#241a4d', '#1d1840', '#2a1d4a', '#12121c', '#1b1b28', '#33205e'] as const;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Validates an image on the client before uploading; the server validates again. */
export function imageProblem(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return 'Use a PNG, JPEG, WebP or GIF image.';
  if (file.size > MAX_IMAGE_BYTES) return 'Images must be 8 MB or smaller.';
  return null;
}

export function useImageUpload(kind: 'avatar' | 'banner') {
  const { setUser } = useAuth();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = () => inputRef.current?.click();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const problem = imageProblem(file);
    if (problem) {
      toast.error('Upload rejected', problem);
      return;
    }
    setBusy(true);
    try {
      const data = await api.uploadImage(kind, file);
      setUser(data.user);
      toast.success(kind === 'avatar' ? 'Avatar updated' : 'Banner updated');
    } catch (error) {
      const described = describeError(error);
      toast.error('Upload failed', described.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const data = await api.removeImage(kind);
      setUser(data.user);
      toast.success(kind === 'avatar' ? 'Avatar removed' : 'Banner removed');
    } catch (error) {
      toast.error('Could not remove image', describeError(error).message);
    } finally {
      setBusy(false);
    }
  };

  return { pick, onFile, remove, busy, inputRef };
}

export function ImageInput({
  inputRef,
  onFile,
  accept = 'image/png,image/jpeg,image/webp,image/gif',
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File | undefined) => void;
  accept?: string;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      hidden
      onChange={(event) => void onFile(event.target.files?.[0])}
    />
  );
}

export function useProfileSave() {
  const { setUser } = useAuth();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const save = async (patch: Parameters<typeof api.updateProfile>[0], message = 'Profile updated') => {
    setSaving(true);
    try {
      const data = await api.updateProfile(patch);
      setUser(data.user);
      toast.success(message);
      return true;
    } catch (error) {
      const described = describeError(error);
      toast.error('Could not save profile', described.fields[Object.keys(described.fields)[0]] ?? described.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { save, saving };
}

export function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}

export type { User };

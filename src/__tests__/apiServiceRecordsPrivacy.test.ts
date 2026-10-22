import {
  createIpfsUploadUrl,
  fetchEligibilityCommitments,
  fetchRecordIpfsStorage,
  fetchRecordKeyMaterial,
  uploadCiphertextToIpfs,
} from '@/services/api.service';

// `var` keeps these hoisted above the jest.mock factory, which runs before imports.
// eslint-disable-next-line no-var
var mockApi: Record<'get' | 'post', jest.Mock>;
// eslint-disable-next-line no-var
var mockAxiosPost: jest.Mock;

jest.mock('axios', () => {
  mockApi = { get: jest.fn(), post: jest.fn() };
  mockAxiosPost = jest.fn();
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => ({ ...mockApi, interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } })),
      post: mockAxiosPost,
    },
  };
});

jest.mock('axios-retry', () => {
  const mockAxiosRetry = jest.fn();
  (mockAxiosRetry as any).exponentialDelay = jest.fn();
  (mockAxiosRetry as any).isNetworkOrIdempotentRequestError = jest.fn();
  return mockAxiosRetry;
});

describe('records privacy API (#27, #28)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetchEligibilityCommitments calls GET /users/:address/eligibility-commitments', async () => {
    mockApi.get.mockResolvedValueOnce({ data: { age18: '1' } });
    await expect(fetchEligibilityCommitments('GABC')).resolves.toEqual({ age18: '1' });
    expect(mockApi.get).toHaveBeenCalledWith('/users/GABC/eligibility-commitments');
  });

  it('createIpfsUploadUrl gets a presigned Pinata URL from the backend', async () => {
    mockApi.post.mockResolvedValueOnce({
      data: { url: 'https://uploads.pinata.cloud/v3/files?sig=1' },
    });
    await expect(createIpfsUploadUrl()).resolves.toBe(
      'https://uploads.pinata.cloud/v3/files?sig=1',
    );
    expect(mockApi.post).toHaveBeenCalledWith('/records/ipfs/upload-url');
  });

  it('uploadCiphertextToIpfs posts the file to the signed URL on the public network', async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: { data: { cid: 'bafkreiabc', id: 'f1' } } });

    await expect(uploadCiphertextToIpfs('https://signed', new Blob(['x']))).resolves.toBe(
      'bafkreiabc',
    );

    const [url, form] = mockAxiosPost.mock.calls[0] as [string, FormData];
    expect(url).toBe('https://signed');
    expect(form.get('network')).toBe('public');
    // The CID profile is fixed when the backend signs the URL, not in the upload form.
    expect(form.get('cid_version')).toBeNull();
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('fetchRecordIpfsStorage and fetchRecordKeyMaterial call the record endpoints', async () => {
    mockApi.get.mockResolvedValueOnce({ data: { cid: 'bafy', pinStatus: 'pinned' } });
    mockApi.get.mockResolvedValueOnce({
      data: { key: 'k', iv: 'i', fileName: 'a.pdf', fileType: 'application/pdf' },
    });

    await fetchRecordIpfsStorage('r1');
    await fetchRecordKeyMaterial('r1');

    expect(mockApi.get).toHaveBeenNthCalledWith(1, '/records/r1/ipfs');
    expect(mockApi.get).toHaveBeenNthCalledWith(2, '/records/r1/key');
  });
});

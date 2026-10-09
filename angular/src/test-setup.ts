import 'fake-indexeddb/auto';

Object.defineProperty(navigator, 'locks', {
  configurable: true,
  value: {
    request: (name: string, _options: { ifAvailable?: boolean }, callback: (lock: { name: string } | null) => Promise<void>) => {
      void callback({ name });
      return Promise.resolve();
    },
  },
});

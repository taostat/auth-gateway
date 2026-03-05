import http from 'http';

interface MockTaostatsApi {
  url: string;
  close: () => Promise<void>;
  calledEndpoints: string[];
}

export async function createMockTaostatsApi(
  responses: Record<string, object> = {},
): Promise<MockTaostatsApi> {
  const calledEndpoints: string[] = [];

  const server = http.createServer((req, res) => {
    calledEndpoints.push(req.url || '');
    const responseData = responses[req.url || ''];
    if (responseData) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseData));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((res) => server.close(() => res())),
        calledEndpoints,
      });
    });
  });
}

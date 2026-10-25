// Uruchamia react-scripts z flagą OpenSSL wymaganą przez webpack 4 na nowszych wersjach Node.
// Działa tak samo na Windows, macOS i Linux (bez cross-env).
const mode = process.argv[2] || 'build';
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --openssl-legacy-provider`.trim();
process.argv = [process.argv[0], require.resolve('react-scripts/bin/react-scripts.js'), mode];
require('react-scripts/bin/react-scripts.js');

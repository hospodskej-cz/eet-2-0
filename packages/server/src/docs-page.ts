/**
 * `GET /docs`: Scalar API reference for /openapi.json. The script comes from jsDelivr at a pinned
 * version with Subresource Integrity, so a changed file is refused by the browser.
 */
const SCALAR =
  "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.73.1/dist/browser/standalone.js";
const SCALAR_SRI = "sha384-kYDGzV91Jnn3TbHINV3nt54riK2uMJDfN5Al8dAkz4FssELTBWbD8rgw32sTKfOi";

export const DOCS_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>EET Gateway API</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="${SCALAR}" integrity="${SCALAR_SRI}" crossorigin="anonymous"></script>
    <script>
      Scalar.createApiReference("#app", { url: "/openapi.json" });
    </script>
  </body>
</html>
`;

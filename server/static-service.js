const fs = require("node:fs");
const path = require("node:path");
const { MIME_TYPES, ROOT_DIR } = require("./config");
const { json } = require("./http");

function serveStatic(req, res, pathname) {
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    json(res, 400, { error: "bad_path" });
    return;
  }

  let filePath = path.join(ROOT_DIR, decodedPathname === "/" ? "index.html" : decodedPathname.slice(1));
  if (!filePath.startsWith(ROOT_DIR)) {
    json(res, 403, { error: "forbidden" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const isSpaPath = !ext && (decodedPathname.startsWith("/invite/") || decodedPathname.startsWith("/queue") || decodedPathname === "/");
  const exists = fs.existsSync(filePath);
  if (isSpaPath) {
    filePath = path.join(ROOT_DIR, "index.html");
  } else if (!exists) {
    json(res, 404, { error: "not_found" });
    return;
  }

  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      json(res, 404, { error: "not_found" });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(buffer);
  });
}

module.exports = {
  serveStatic,
};

const crypto = require("node:crypto");

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isUnsafeMethod(method) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(String(method).toUpperCase());
}

function hasJsonContentType(req) {
  return String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase() === "application/json";
}

function httpError(statusCode, publicCode) {
  const error = new Error(publicCode);
  error.statusCode = statusCode;
  error.publicCode = publicCode;
  return error;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(httpError(413, "payload_too_large"));
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(httpError(400, "bad_json"));
      }
    });
    req.on("error", reject);
  });
}

function safeText(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text.replace(/\s+/g, " ").slice(0, 60) || fallback;
}

function randomId(prefix = "", bytes = 12) {
  return `${prefix}${crypto.randomBytes(bytes).toString("base64url")}`;
}

function randomInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

module.exports = {
  timingSafeEqualText,
  isUnsafeMethod,
  hasJsonContentType,
  httpError,
  readBody,
  safeText,
  randomId,
  randomInviteCode,
};

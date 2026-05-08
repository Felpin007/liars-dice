const QRCode = require("qrcode");

async function svgForText(text) {
  const value = String(text || "").slice(0, 1000);
  if (!value) {
    const error = new Error("qr_required");
    error.statusCode = 400;
    error.publicCode = "qr_required";
    throw error;
  }
  return QRCode.toString(value, {
    type: "svg",
    margin: 1,
    width: 220,
    errorCorrectionLevel: "M",
  });
}

module.exports = {
  svgForText,
};

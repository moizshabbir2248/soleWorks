const multer = require("multer");
const path = require("path");

const ALLOWED_MIMETYPES = new Set(["image/jpeg", "image/png"]);
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
const INVALID_IMAGE_MESSAGE = "Only .jpg, .jpeg or .png image files are allowed.";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

function detectImageType(buf) {
  if (Buffer.isBuffer(buf) && buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (Buffer.isBuffer(buf) && buf.length >= 3 && buf.subarray(0, 3).equals(JPEG_SIGNATURE)) {
    return "image/jpeg";
  }
  return null;
}

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!file || !ALLOWED_MIMETYPES.has(file.mimetype)) {
    return cb(new Error(INVALID_IMAGE_MESSAGE), false);
  }
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error(INVALID_IMAGE_MESSAGE), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    files: 1,
    fields: 30,
  },
});

async function inspectUploadedImage(req, res, next) {
  if (!req.file) return next();
  try {
    const detected = detectImageType(req.file.buffer);
    if (!detected) {
      return res.status(400).json({ message: "Uploaded file is not a valid PNG or JPEG image." });
    }
    req.file.mimetype = detected;
    return next();
  } catch (err) {
    return next(err);
  }
}

function fileToDataUrl(file) {
  if (!file || !file.buffer) return null;
  return `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
}

module.exports = upload;
module.exports.inspectUploadedImage = inspectUploadedImage;
module.exports.INVALID_IMAGE_MESSAGE = INVALID_IMAGE_MESSAGE;
module.exports.fileToDataUrl = fileToDataUrl;
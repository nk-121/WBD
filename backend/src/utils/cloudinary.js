const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

let isConfigured = false;

function ensureConfigured() {
  if (isConfigured) return;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary env vars missing: CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET');
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret
  });

  isConfigured = true;
}

function uploadImageBuffer(buffer, options = {}) {
  ensureConfigured();
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'image',
        ...options
      },
      (err, result) => {
        if (err) return reject(err);
        return resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

async function destroyImage(publicId) {
  ensureConfigured();
  if (!publicId) return null;
  try {
    return await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  } catch (e) {
    return null;
  }
}

module.exports = {
  cloudinary,
  uploadImageBuffer,
  destroyImage
};

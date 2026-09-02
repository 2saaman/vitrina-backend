const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Video faylni Cloudinary'ga yuklaydi va doimiy (turg'un) havolasini qaytaradi.
 * @param {string} localPath - lokal video fayl yo'li
 * @param {string} publicId - Cloudinary'dagi noyob nom
 * @returns {Promise<string>} secure_url
 */
async function uploadVideo(localPath, publicId) {
  const result = await cloudinary.uploader.upload(localPath, {
    resource_type: 'video',
    public_id: publicId,
    folder: 'vitrina'
  });
  return result.secure_url;
}

module.exports = { uploadVideo };

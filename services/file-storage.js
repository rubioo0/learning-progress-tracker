const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const config = require('../config/app-config');

class FileStorageService {
	constructor() {
		this.backend = config.STORAGE_BACKEND;
		this.cloudinaryEnabled = config.CLOUDINARY.CONFIGURED && this.backend === 'cloudinary';

		if (this.cloudinaryEnabled) {
			cloudinary.config({
				cloud_name: config.CLOUDINARY.CLOUD_NAME,
				api_key: config.CLOUDINARY.API_KEY,
				api_secret: config.CLOUDINARY.API_SECRET,
				secure: true
			});
		}

		this.tempUpload = this._createLocalUploadMiddleware();
		this.upload = this._createUploadMiddleware();
	}

	_createLocalUploadMiddleware() {
		if (!fs.existsSync(config.UPLOAD_DIRECTORY)) {
			fs.mkdirSync(config.UPLOAD_DIRECTORY, { recursive: true });
		}

		return multer({ dest: config.UPLOAD_DIRECTORY });
	}

	_createUploadMiddleware() {
		if (this.cloudinaryEnabled) {
			const storage = new CloudinaryStorage({
				cloudinary,
				params: async (req, file) => {
					const safeBaseName = String(path.parse(file.originalname || 'attachment').name)
						.replace(/[^a-zA-Z0-9_-]/g, '_')
						.slice(0, 64);

					return {
						folder: config.CLOUDINARY.FOLDER,
						resource_type: config.CLOUDINARY.RESOURCE_TYPE,
						public_id: `${Date.now()}-${safeBaseName || 'attachment'}`
					};
				}
			});

			return multer({ storage });
		}

		return this._createLocalUploadMiddleware();
	}

	getUploadMiddleware() {
		return this.upload;
	}

	getTemporaryUploadMiddleware() {
		return this.tempUpload;
	}

	isRemotePath(filePath) {
		return /^https?:\/\//i.test(String(filePath || ''));
	}

	getAbsoluteLocalPath(filePath) {
		if (!filePath) {
			return null;
		}

		if (path.isAbsolute(filePath)) {
			return filePath;
		}

		return path.join(process.cwd(), filePath);
	}

	async readFileBuffer(filePath) {
		if (!filePath) {
			throw new Error('Missing file path.');
		}

		if (this.isRemotePath(filePath)) {
			const response = await fetch(filePath);
			if (!response.ok) {
				throw new Error(`Failed to fetch remote file (${response.status}).`);
			}

			const arrayBuffer = await response.arrayBuffer();
			return Buffer.from(arrayBuffer);
		}

		const absolutePath = this.getAbsoluteLocalPath(filePath);
		return fs.readFileSync(absolutePath);
	}

	async removeAttachment(attachment) {
		if (!attachment || !attachment.attachment_path) {
			return;
		}

		const attachmentPath = attachment.attachment_path;
		const attachmentFileId = attachment.attachment_filename;

		if (this.isRemotePath(attachmentPath) && this.cloudinaryEnabled && attachmentFileId) {
			await cloudinary.uploader.destroy(attachmentFileId, {
				resource_type: config.CLOUDINARY.RESOURCE_TYPE,
				invalidate: true
			});
			return;
		}

		const localPath = this.getAbsoluteLocalPath(attachmentPath);
		if (localPath && fs.existsSync(localPath)) {
			fs.unlinkSync(localPath);
		}
	}

	getStorageMetadata(uploadedFile) {
		if (!uploadedFile) {
			return null;
		}

		const attachmentPath = uploadedFile.path || uploadedFile.secure_url;
		const attachmentFileId = uploadedFile.filename || uploadedFile.public_id || null;

		return {
			attachmentPath,
			attachmentFileId,
			originalName: uploadedFile.originalname,
			size: uploadedFile.size || null,
			isRemote: this.isRemotePath(attachmentPath)
		};
	}

	getInfo() {
		return {
			backend: this.cloudinaryEnabled ? 'cloudinary' : 'local',
			cloudinaryEnabled: this.cloudinaryEnabled
		};
	}
}

module.exports = FileStorageService;

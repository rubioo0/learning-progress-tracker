const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

class FileStorageService {
    constructor() {
        this.initializeCloudinary();
        this.setupStorage();
    }

    initializeCloudinary() {
        // Configure Cloudinary if credentials are provided
        if (process.env.CLOUDINARY_CLOUD_NAME && 
            process.env.CLOUDINARY_API_KEY && 
            process.env.CLOUDINARY_API_SECRET) {
            
            cloudinary.config({
                cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
                api_key: process.env.CLOUDINARY_API_KEY,
                api_secret: process.env.CLOUDINARY_API_SECRET
            });
            
            this.cloudinaryEnabled = true;
            console.log('Cloudinary initialized for persistent file storage');
        } else {
            this.cloudinaryEnabled = false;
            console.log('Cloudinary not configured, using local storage (will be lost on restart)');
        }
    }

    setupStorage() {
        if (this.cloudinaryEnabled) {
            // Use Cloudinary storage
            this.storage = new CloudinaryStorage({
                cloudinary: cloudinary,
                params: {
                    folder: 'learning-tracker-attachments',
                    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'txt', 'md', 'json', 'xlsx', 'xls', 'csv'],
                    resource_type: 'auto'
                }
            });
        } else {
            // Use local storage (fallback)
            this.storage = multer.diskStorage({
                destination: function (req, file, cb) {
                    const uploadDir = 'uploads/';
                    if (!fs.existsSync(uploadDir)) {
                        fs.mkdirSync(uploadDir, { recursive: true });
                    }
                    cb(null, uploadDir);
                },
                filename: function (req, file, cb) {
                    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
                    cb(null, uniqueName);
                }
            });
        }
    }

    getMulterInstance() {
        return multer({ 
            storage: this.storage,
            limits: {
                fileSize: 10 * 1024 * 1024 // 10MB limit
            },
            fileFilter: (req, file, cb) => {
                // Allow most common file types
                const allowedTypes = [
                    'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
                    'application/pdf',
                    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'text/plain', 'text/markdown',
                    'application/json',
                    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'text/csv'
                ];
                
                if (allowedTypes.includes(file.mimetype)) {
                    cb(null, true);
                } else {
                    cb(new Error('File type not supported'), false);
                }
            }
        });
    }

    // Get file URL (works for both local and cloud storage)
    getFileUrl(file) {
        if (this.cloudinaryEnabled && file.path) {
            // Cloudinary provides the full URL in file.path
            return file.path;
        } else if (file.filename) {
            // Local storage - construct relative URL
            return `/uploads/${file.filename}`;
        }
        return null;
    }

    // Delete file (works for both local and cloud storage)
    async deleteFile(filePath, fileUrl) {
        if (this.cloudinaryEnabled && fileUrl) {
            try {
                // Extract public_id from URL for Cloudinary deletion
                const urlParts = fileUrl.split('/');
                const publicIdWithExtension = urlParts[urlParts.length - 1];
                const publicId = `learning-tracker-attachments/${publicIdWithExtension.split('.')[0]}`;
                
                await cloudinary.uploader.destroy(publicId);
                console.log('File deleted from Cloudinary:', publicId);
            } catch (error) {
                console.error('Error deleting file from Cloudinary:', error);
            }
        } else if (filePath && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                console.log('Local file deleted:', filePath);
            } catch (error) {
                console.error('Error deleting local file:', error);
            }
        }
    }

    // Check if file exists and is accessible
    async checkFileExists(filePath, fileUrl) {
        if (this.cloudinaryEnabled && fileUrl) {
            try {
                // For Cloudinary, we can try to access the URL
                const response = await fetch(fileUrl, { method: 'HEAD' });
                return response.ok;
            } catch (error) {
                return false;
            }
        } else {
            return filePath && fs.existsSync(filePath);
        }
    }

    // Get file content for preview (mainly for local files)
    async getFileContent(filePath, fileUrl) {
        if (this.cloudinaryEnabled && fileUrl) {
            // For cloud files, return the URL for client-side access
            return { url: fileUrl, type: 'url' };
        } else if (filePath && fs.existsSync(filePath)) {
            // For local files, read content
            try {
                const content = fs.readFileSync(filePath);
                return { content: content, type: 'buffer' };
            } catch (error) {
                throw new Error('Error reading file content');
            }
        } else {
            throw new Error('File not found');
        }
    }
}

module.exports = FileStorageService;

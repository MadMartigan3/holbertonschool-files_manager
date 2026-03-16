import { v4 as uuidv4 } from 'uuid';
import { mkdir, writeFile } from 'fs';
import { promisify } from 'util';
import path from 'path';
import pkg from 'mongodb';
import redisClient from '../utils/redis';
import dbClient from '../utils/db';

const mkdirAsync = promisify(mkdir);
const writeFileAsync = promisify(writeFile);
const { ObjectID } = pkg;

const ACCEPTED_TYPES = ['folder', 'file', 'image'];
const FOLDER_PATH = process.env.FOLDER_PATH || '/tmp/files_manager';

class FilesController {
  static async postUpload(req, res) {
    // Authenticate user
    const token = req.headers['x-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const usersCollection = await dbClient.collection('users');
    const user = await usersCollection.findOne({ _id: new ObjectID(userId) });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // Validate input
    const {
      name, type, parentId = 0, isPublic = false, data,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Missing name' });
    if (!type || !ACCEPTED_TYPES.includes(type)) return res.status(400).json({ error: 'Missing type' });
    if (!data && type !== 'folder') return res.status(400).json({ error: 'Missing data' });

    // Validate parentId
    const filesCollection = await dbClient.collection('files');
    if (parentId !== 0) {
      const parentFile = await filesCollection.findOne({ _id: new ObjectID(parentId) });
      if (!parentFile) return res.status(400).json({ error: 'Parent not found' });
      if (parentFile.type !== 'folder') return res.status(400).json({ error: 'Parent is not a folder' });
    }

    // Build document
    const fileDoc = {
      userId: new ObjectID(userId),
      name,
      type,
      isPublic,
      parentId,
    };

    // If folder, just save to DB
    if (type === 'folder') {
      const result = await filesCollection.insertOne(fileDoc);
      return res.status(201).json({
        id: result.insertedId,
        userId,
        name,
        type,
        isPublic,
        parentId,
      });
    }

    // Otherwise, save file to disk
    await mkdirAsync(FOLDER_PATH, { recursive: true });
    const localPath = path.join(FOLDER_PATH, uuidv4());
    const fileBuffer = Buffer.from(data, 'base64');
    await writeFileAsync(localPath, fileBuffer);

    fileDoc.localPath = localPath;
    const result = await filesCollection.insertOne(fileDoc);

    return res.status(201).json({
      id: result.insertedId,
      userId,
      name,
      type,
      isPublic,
      parentId,
      localPath,
    });
  }
}

export default FilesController;

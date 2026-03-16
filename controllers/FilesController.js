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
const PAGE_SIZE = 20;

class FilesController {
  static async postUpload(req, res) {
    const token = req.headers['x-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const usersCollection = await dbClient.collection('users');
    const user = await usersCollection.findOne({ _id: new ObjectID(userId) });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const {
      name, type, parentId = 0, isPublic = false, data,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Missing name' });
    if (!type || !ACCEPTED_TYPES.includes(type)) return res.status(400).json({ error: 'Missing type' });
    if (!data && type !== 'folder') return res.status(400).json({ error: 'Missing data' });

    const filesCollection = await dbClient.collection('files');
    if (parentId !== 0) {
      const parentFile = await filesCollection.findOne({ _id: new ObjectID(parentId) });
      if (!parentFile) return res.status(400).json({ error: 'Parent not found' });
      if (parentFile.type !== 'folder') return res.status(400).json({ error: 'Parent is not a folder' });
    }

    const fileDoc = {
      userId: new ObjectID(userId),
      name,
      type,
      isPublic,
      parentId,
    };

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

  static async getShow(req, res) {
    const token = req.headers['x-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const filesCollection = await dbClient.collection('files');
    const file = await filesCollection.findOne({
      _id: new ObjectID(req.params.id),
      userId: new ObjectID(userId),
    });

    if (!file) return res.status(404).json({ error: 'Not found' });

    return res.status(200).json({
      id: file._id,
      userId: file.userId,
      name: file.name,
      type: file.type,
      isPublic: file.isPublic,
      parentId: file.parentId,
    });
  }

  static async getIndex(req, res) {
  const token = req.headers['x-token'];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const userId = await redisClient.get(`auth_${token}`);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const rawParentId = req.query.parentId;
  const parentId = rawParentId && rawParentId !== '0' ? rawParentId : 0;
  const page = parseInt(req.query.page, 10) || 0;

  try {
    const filesCollection = await dbClient.collection('files');
    const files = await filesCollection
      .find({ userId: new ObjectID(userId), parentId })
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .toArray();

    const result = files.map((file) => ({
      id: file._id,
      userId: file.userId,
      name: file.name,
      type: file.type,
      isPublic: file.isPublic,
      parentId: file.parentId,
    }));

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
}

export default FilesController;

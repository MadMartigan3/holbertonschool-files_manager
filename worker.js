import Bull from 'bull';
import imageThumbnail from 'image-thumbnail';
import { writeFile } from 'fs';
import { promisify } from 'util';
import pkg from 'mongodb';
import dbClient from './utils/db';

const writeFileAsync = promisify(writeFile);
const { ObjectID } = pkg;

const fileQueue = new Bull('fileQueue');

fileQueue.process(async (job) => {
  const { fileId, userId } = job.data;

  if (!fileId) throw new Error('Missing fileId');
  if (!userId) throw new Error('Missing userId');

  const filesCollection = await dbClient.collection('files');
  const file = await filesCollection.findOne({
    _id: new ObjectID(fileId),
    userId: new ObjectID(userId),
  });

  if (!file) throw new Error('File not found');

  const sizes = [500, 250, 100];
  await Promise.all(sizes.map(async (width) => {
    const thumbnail = await imageThumbnail(file.localPath, { width });
    await writeFileAsync(`${file.localPath}_${width}`, thumbnail);
  }));
});

export default fileQueue;

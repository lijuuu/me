import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is not set");

// caches the client across next.js dev hot-reloads so we don't open a new
// mongo connection on every file change (the standard next.js + mongodb pattern)
const globalForMongo = globalThis as unknown as { _mongoClientPromise?: Promise<MongoClient> };

const clientPromise: Promise<MongoClient> =
  globalForMongo._mongoClientPromise ??
  new MongoClient(uri)
    .connect()
    .then(async (client) => {
      await client
        .db()
        .collection("pastes")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      return client;
    });

if (process.env.NODE_ENV !== "production") {
  globalForMongo._mongoClientPromise = clientPromise;
}

export interface PasteDoc {
  _id: string;
  type: "markdown" | "code";
  content: string;
  language: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export async function pastesCollection() {
  const client = await clientPromise;
  return client.db().collection<PasteDoc>("pastes");
}

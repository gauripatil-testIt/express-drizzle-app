import express from "express";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { publicUserColumns, users } from "./db/schema.js";
import { authRouter } from "./routes/auth.js";

const app = express();
app.use(express.json());

app.use("/auth", authRouter);

app.get("/users", async (_req, res) => {
  res.json(await db.select(publicUserColumns).from(users));
});

app.get("/users/:id", async (req, res) => {
  const [user] = await db.select(publicUserColumns).from(users).where(eq(users.id, Number(req.params.id)));
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json(user);
});

app.post("/users", async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: "name and email required" });
  const [user] = await db.insert(users).values({ name, email }).returning(publicUserColumns);
  res.status(201).json(user);
});

app.put("/users/:id", async (req, res) => {
  const { name, email } = req.body;
  const [user] = await db
    .update(users)
    .set({ name, email })
    .where(eq(users.id, Number(req.params.id)))
    .returning(publicUserColumns);
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json(user);
});

app.delete("/users/:id", async (req, res) => {
  const [user] = await db.delete(users).where(eq(users.id, Number(req.params.id))).returning();
  if (!user) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => console.log(`Listening on http://localhost:${port}`));

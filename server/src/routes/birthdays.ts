import { Router } from "express";
import { z } from "zod";
import { requireContributor } from "../auth/middleware.js";
import { archiveFilters, collectionArchive } from "../lib/archive.js";
import {
  addBirthday,
  addCategory,
  birthdayCategories,
  birthdayGrid,
  findBirthday,
  findBirthdays,
  looseMemoryIds,
  MAX_BIRTHDAY,
  reorderCategories,
} from "../lib/birthdays.js";
import { childSummaryOf } from "../lib/children.js";
import { collectionDto } from "../lib/serialize.js";

export const birthdaysRouter = Router();

/** A child's Birthdays: one tile per added birthday. */
birthdaysRouter.get("/collections/:id/birthdays", async (req, res) => {
  const family = req.ctx.family;
  const birthdays = await findBirthdays(family.id, req.params.id);
  if (!birthdays) return res.status(404).json({ error: "Birthdays not found" });

  const [grid, child] = await Promise.all([
    birthdayGrid(family.id, birthdays),
    childSummaryOf(family.id, birthdays.person),
  ]);
  res.json({ collection: collectionDto(birthdays), child, ...grid });
});

const looseQuery = archiveFilters.extend({
  birthday: z.union([z.literal("unsorted"), z.coerce.number().int().min(1).max(MAX_BIRTHDAY)]),
});

/** The archive of memories filed straight in Birthdays nearest one birthday, or none added ("unsorted"). */
birthdaysRouter.get("/collections/:id/loose", async (req, res) => {
  const family = req.ctx.family;
  const parsed = looseQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const birthdays = await findBirthdays(family.id, req.params.id);
  if (!birthdays) return res.status(404).json({ error: "Birthdays not found" });

  const ids = await looseMemoryIds(family.id, birthdays, parsed.data.birthday);
  res.json(await collectionArchive(family.id, birthdays, parsed.data, ids));
});

const newBirthday = z.object({ birthday: z.number().int().min(1).max(MAX_BIRTHDAY) });

birthdaysRouter.post("/collections/:id/birthdays", requireContributor, async (req, res) => {
  const family = req.ctx.family;
  const parsed = newBirthday.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const birthdays = await findBirthdays(family.id, req.params.id);
  if (!birthdays) return res.status(404).json({ error: "Birthdays not found" });

  const birthday = await addBirthday(birthdays, parsed.data.birthday);
  if (!birthday) return res.status(409).json({ error: "birthday_exists" });
  res.status(201).json({ birthday: collectionDto(birthday) });
});

const categoriesQuery = z.object({ q: z.string().trim().max(120).optional() });

/** One birthday's categories, and the memories filed straight in Birthdays nearest it. */
birthdaysRouter.get("/collections/:id/categories", async (req, res) => {
  const family = req.ctx.family;
  const parsed = categoriesQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const birthday = await findBirthday(family.id, req.params.id);
  if (!birthday) return res.status(404).json({ error: "Birthday not found" });

  const [categories, child] = await Promise.all([
    birthdayCategories(family.id, birthday, parsed.data.q || undefined),
    childSummaryOf(family.id, birthday.parent.person),
  ]);
  res.json({
    birthday: collectionDto(birthday),
    birthdays: collectionDto(birthday.parent),
    child,
    ...categories,
  });
});

const newCategory = z.object({ name: z.string().trim().min(1).max(80) });

birthdaysRouter.post("/collections/:id/categories", requireContributor, async (req, res) => {
  const family = req.ctx.family;
  const parsed = newCategory.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const birthday = await findBirthday(family.id, req.params.id);
  if (!birthday) return res.status(404).json({ error: "Birthday not found" });

  const category = await addCategory(birthday, parsed.data.name);
  res.status(201).json({ collection: collectionDto(category) });
});

const categoryOrder = z.object({ ids: z.array(z.string()).max(200) });

birthdaysRouter.put("/collections/:id/categories/order", requireContributor, async (req, res) => {
  const family = req.ctx.family;
  const parsed = categoryOrder.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const birthday = await findBirthday(family.id, req.params.id);
  if (!birthday) return res.status(404).json({ error: "Birthday not found" });

  if (!(await reorderCategories(birthday, parsed.data.ids))) {
    return res.status(409).json({ error: "categories_changed" });
  }
  res.status(204).end();
});

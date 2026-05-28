import { createApp } from "../app";
import {
  prisma,
  createTestUser,
  createTestProject,
  createTestWiki,
  cleanDatabase,
} from "./setup";
import { post, get, put, del, expectSuccess, expectError } from "./helpers";
import * as wikiService from "../modules/wiki/wiki.service";
import type { Application } from "express";

describe("Wiki Tests", () => {
  let app: Application;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  describe("Wiki Persistence", () => {
    it("should create and persist a wiki document", async () => {
      const { user, token } = await createTestUser();

      const res = await post(
        app,
        "/api/v1/wiki",
        {
          title: "Getting Started",
          slug: "getting-started",
          content: "# Getting Started\n\nWelcome to the wiki!",
          status: "draft",
        },
        token
      );

      expectSuccess(res, 201);
      expect(res.body.data.title).toBe("Getting Started");
      expect(res.body.data.slug).toBe("getting-started");
      expect(res.body.data.content).toBe("# Getting Started\n\nWelcome to the wiki!");
      expect(res.body.data.status).toBe("draft");
      expect(res.body.data.created_by).toBe(user.id);
    });

    it("should retrieve wiki by ID", async () => {
      const { user, token } = await createTestUser();
      const wiki = await createTestWiki({
        title: "Test Wiki",
        slug: "test-wiki",
        content: "Test content",
        created_by: user.id,
      });

      const res = await get(app, `/api/v1/wiki/${wiki.id}`, token);

      expectSuccess(res, 200);
      expect(res.body.data.title).toBe("Test Wiki");
      expect(res.body.data.content).toBe("Test content");
    });

    it("should retrieve wiki by slug", async () => {
      const { user, token } = await createTestUser();
      const wiki = await createTestWiki({
        title: "Slug Test",
        slug: "slug-test",
        content: "Content by slug",
        created_by: user.id,
      });

      const res = await get(app, `/api/v1/wiki/slug/slug-test`, token);

      expectSuccess(res, 200);
      expect(res.body.data.title).toBe("Slug Test");
      expect(res.body.data.slug).toBe("slug-test");
    });

    it("should update wiki content", async () => {
      const { user, token } = await createTestUser();
      const wiki = await createTestWiki({
        title: "Update Test",
        slug: "update-test",
        content: "Original content",
        created_by: user.id,
      });

      const res = await put(
        app,
        `/api/v1/wiki/${wiki.id}`,
        { content: "Updated content" },
        token
      );

      expectSuccess(res, 200);

      const updated = await prisma.wikiDocument.findUnique({
        where: { id: wiki.id },
      });
      expect(updated!.content).toBe("Updated content");
    });

    it("should prevent duplicate slugs in same scope", async () => {
      const { user, token } = await createTestUser();

      await post(
        app,
        "/api/v1/wiki",
        {
          title: "First",
          slug: "duplicate-slug",
          content: "First content",
        },
        token
      );

      const res = await post(
        app,
        "/api/v1/wiki",
        {
          title: "Second",
          slug: "duplicate-slug",
          content: "Second content",
        },
        token
      );

      expectError(res, 409, "DUPLICATE_ERROR");
    });

    it("should allow same slug in different projects", async () => {
      const { user, token } = await createTestUser();
      const project1 = await createTestProject({ owner_id: user.id });
      const project2 = await createTestProject({ owner_id: user.id });

      const res1 = await post(
        app,
        "/api/v1/wiki",
        {
          title: "Project 1 Wiki",
          slug: "shared-slug",
          content: "Project 1 content",
          project_id: project1.id,
        },
        token
      );

      expectSuccess(res1, 201);

      const res2 = await post(
        app,
        "/api/v1/wiki",
        {
          title: "Project 2 Wiki",
          slug: "shared-slug",
          content: "Project 2 content",
          project_id: project2.id,
        },
        token
      );

      expectSuccess(res2, 201);
    });

    it("should delete wiki document", async () => {
      const { user, token } = await createTestUser();
      const wiki = await createTestWiki({
        title: "Delete Test",
        slug: "delete-test",
        created_by: user.id,
      });

      const res = await del(app, `/api/v1/wiki/${wiki.id}`, token);

      expectSuccess(res, 200);

      const deleted = await prisma.wikiDocument.findUnique({
        where: { id: wiki.id },
      });
      expect(deleted).toBeNull();
    });
  });

  describe("Markdown Rendering Data", () => {
    it("should store markdown content for rendering", async () => {
      const { user, token } = await createTestUser();
      const markdownContent = `# Heading 1

## Heading 2

This is **bold** and *italic* text.

- List item 1
- List item 2
- List item 3

\`\`\`typescript
const x = 1;
\`\`\`

> A blockquote

[A link](https://example.com)`;

      const res = await post(
        app,
        "/api/v1/wiki",
        {
          title: "Markdown Test",
          slug: "markdown-test",
          content: markdownContent,
        },
        token
      );

      expectSuccess(res, 201);
      expect(res.body.data.content).toBe(markdownContent);

      const retrieved = await get(app, `/api/v1/wiki/${res.body.data.id}`, token);
      expectSuccess(retrieved, 200);
      expect(retrieved.body.data.content).toBe(markdownContent);
    });

    it("should handle wiki with tables in markdown", async () => {
      const { user, token } = await createTestUser();
      const content = `| Character | Voice Actor |
|-----------|-------------|
| Hero      | Actor A     |
| Villain   | Actor B     |`;

      const res = await post(
        app,
        "/api/v1/wiki",
        {
          title: "Table Test",
          slug: "table-test",
          content,
        },
        token
      );

      expectSuccess(res, 201);
      expect(res.body.data.content).toContain("| Character | Voice Actor |");
    });
  });

  describe("Glossary-Table Retrieval", () => {
    it("should store and retrieve glossary table data", async () => {
      const { user, token } = await createTestUser();
      const glossaryContent = `## Glossary

| Term | Translation | Notes |
|------|-------------|-------|
| 魔法 | Magic | Keep as is |
| 勇者 | Hero | Capitalized |
| 魔王 | Demon Lord | Official term |`;

      const res = await post(
        app,
        "/api/v1/wiki",
        {
          title: "Project Glossary",
          slug: "glossary",
          content: glossaryContent,
        },
        token
      );

      expectSuccess(res, 201);

      const retrieved = await get(app, `/api/v1/wiki/${res.body.data.id}`, token);
      expectSuccess(retrieved, 200);
      expect(retrieved.body.data.content).toContain("魔法");
      expect(retrieved.body.data.content).toContain("Magic");
    });

    it("should search wikis by content", async () => {
      const { user, token } = await createTestUser();

      await createTestWiki({
        title: "Glossary A",
        slug: "glossary-a",
        content: "Special term: Chunnibyou",
        created_by: user.id,
      });

      await createTestWiki({
        title: "Glossary B",
        slug: "glossary-b",
        content: "Special term: Isekai",
        created_by: user.id,
      });

      await createTestWiki({
        title: "Other Doc",
        slug: "other-doc",
        content: "Nothing special here",
        created_by: user.id,
      });

      const res = await get(app, `/api/v1/wiki?search=Special+term`, token);

      expectSuccess(res, 200);
      expect(res.body.data.wikis.length).toBe(2);
    });
  });

  describe("Wiki Approval Flow Configuration", () => {
    it("should save approved edit to pending_content", async () => {
      const { user, token } = await createTestUser();
      const wiki = await createTestWiki({
        title: "Approval Test",
        slug: "approval-test",
        content: "Original approved content",
        status: "approved",
        created_by: user.id,
      });

      const res = await put(
        app,
        `/api/v1/wiki/${wiki.id}`,
        { content: "New pending content" },
        token
      );

      expectSuccess(res, 200);

      const updated = await prisma.wikiDocument.findUnique({
        where: { id: wiki.id },
      });
      expect(updated!.content).toBe("Original approved content");
      expect(updated!.pending_content).toBe("New pending content");
      expect(updated!.status).toBe("pending");
    });

    it("should approve pending wiki changes", async () => {
      const { user: creator, token: creatorToken } = await createTestUser();
      const { user: approver, token: approverToken } = await createTestUser({ role: "supervisor" });
      const wiki = await createTestWiki({
        title: "Approve Test",
        slug: "approve-test",
        content: "Original",
        pending_content: "Pending changes",
        status: "pending",
        created_by: creator.id,
      });

      const res = await post(
        app,
        `/api/v1/wiki/${wiki.id}/approve`,
        { approved: true },
        approverToken
      );

      expectSuccess(res, 200);
      expect(res.body.data.approved).toBe(true);

      const updated = await prisma.wikiDocument.findUnique({
        where: { id: wiki.id },
      });
      expect(updated!.content).toBe("Pending changes");
      expect(updated!.pending_content).toBeNull();
      expect(updated!.status).toBe("approved");
      expect(updated!.approved_by).toBe(approver.id);
      expect(updated!.approved_at).not.toBeNull();
    });

    it("should reject pending wiki changes", async () => {
      const { user: creator, token: creatorToken } = await createTestUser();
      const { user: approver, token: approverToken } = await createTestUser({ role: "supervisor" });
      const wiki = await createTestWiki({
        title: "Reject Test",
        slug: "reject-test",
        content: "Original",
        pending_content: "Bad changes",
        status: "pending",
        created_by: creator.id,
      });

      const res = await post(
        app,
        `/api/v1/wiki/${wiki.id}/approve`,
        { approved: false, rejection_reason: "Needs more work" },
        approverToken
      );

      expectSuccess(res, 200);
      expect(res.body.data.approved).toBe(false);

      const updated = await prisma.wikiDocument.findUnique({
        where: { id: wiki.id },
      });
      expect(updated!.content).toBe("Original");
      expect(updated!.pending_content).toBe("Bad changes");
      expect(updated!.status).toBe("draft");
    });

    it("should not require approval for draft wiki edits", async () => {
      const { user, token } = await createTestUser();
      const wiki = await createTestWiki({
        title: "Draft Test",
        slug: "draft-test",
        content: "Draft content",
        status: "draft",
        created_by: user.id,
      });

      const res = await put(
        app,
        `/api/v1/wiki/${wiki.id}`,
        { content: "Updated draft content" },
        token
      );

      expectSuccess(res, 200);

      const updated = await prisma.wikiDocument.findUnique({
        where: { id: wiki.id },
      });
      expect(updated!.content).toBe("Updated draft content");
      expect(updated!.pending_content).toBeNull();
    });

    it("should archive wiki document", async () => {
      const { user, token } = await createTestUser();
      const wiki = await createTestWiki({
        title: "Archive Test",
        slug: "archive-test",
        content: "Content",
        status: "approved",
        created_by: user.id,
      });

      const res = await put(
        app,
        `/api/v1/wiki/${wiki.id}`,
        { status: "archived" },
        token
      );

      expectSuccess(res, 200);

      const updated = await prisma.wikiDocument.findUnique({
        where: { id: wiki.id },
      });
      expect(updated!.status).toBe("archived");
    });
  });

  describe("Wiki Comments", () => {
    it("should create comments on wiki documents", async () => {
      const { user, token } = await createTestUser();
      const wiki = await createTestWiki({
        title: "Comment Test",
        slug: "comment-test",
        created_by: user.id,
      });

      const res = await post(
        app,
        `/api/v1/wiki/${wiki.id}/comments`,
        { content: "Great documentation!" },
        token
      );

      expectSuccess(res, 201);
      expect(res.body.data.content).toBe("Great documentation!");
      expect(res.body.data.user_id).toBe(user.id);
    });

    it("should retrieve comments for a wiki", async () => {
      const { user, token } = await createTestUser();
      const wiki = await createTestWiki({
        title: "Comments Test",
        slug: "comments-test",
        created_by: user.id,
      });

      await prisma.comment.create({
        data: {
          user_id: user.id,
          content: "First comment",
          wiki_id: wiki.id,
        },
      });

      await prisma.comment.create({
        data: {
          user_id: user.id,
          content: "Second comment",
          wiki_id: wiki.id,
        },
      });

      const res = await get(app, `/api/v1/wiki/${wiki.id}/comments`, token);

      expectSuccess(res, 200);
      expect(res.body.data.length).toBe(2);
    });

    it("should support threaded replies", async () => {
      const { user, token } = await createTestUser();
      const wiki = await createTestWiki({
        title: "Thread Test",
        slug: "thread-test",
        created_by: user.id,
      });

      const parent = await prisma.comment.create({
        data: {
          user_id: user.id,
          content: "Parent comment",
          wiki_id: wiki.id,
        },
      });

      const reply = await prisma.comment.create({
        data: {
          user_id: user.id,
          content: "Reply to parent",
          wiki_id: wiki.id,
          parent_id: parent.id,
        },
      });

      const retrieved = await prisma.comment.findUnique({
        where: { id: parent.id },
        include: { replies: true },
      });

      expect(retrieved!.replies.length).toBe(1);
      expect(retrieved!.replies[0].content).toBe("Reply to parent");
    });
  });
});

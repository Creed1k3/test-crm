import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const { API_URL, PUBLISHABLE_KEY, ANON_KEY, SECRET_KEY, SERVICE_ROLE_KEY, CRM_TEST_LOGINS } = process.env;
const publicKey = PUBLISHABLE_KEY || ANON_KEY;
assert(API_URL && publicKey, "Set API_URL and PUBLISHABLE_KEY (or ANON_KEY).");

function client(key = publicKey) {
  return createClient(API_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function success({ data, error }, label) {
  assert.ifError(error && new Error(`${label}: ${error.message}`));
  return data;
}

async function testAccounts() {
  if (CRM_TEST_LOGINS) return JSON.parse(CRM_TEST_LOGINS);

  assert(new URL(API_URL).hostname === "127.0.0.1", "Automatic user creation is local only.");
  const adminKey = SECRET_KEY || SERVICE_ROLE_KEY;
  assert(adminKey, "Set the local Supabase secret key.");
  const admin = client(adminKey);
  const roles = ["manager", "performer", "performer"];

  return Promise.all(roles.map(async (role, index) => {
    const email = `workflow-${crypto.randomUUID()}@example.com`;
    const password = crypto.randomUUID();
    const { user } = success(await admin.auth.admin.createUser({ email, password, email_confirm: true }), "create test user");
    success(await admin.from("profiles").insert({ id: user.id, display_name: `Workflow ${index + 1}`, role }), "create test profile");
    return { email, password };
  }));
}

const [manager, first, second] = await Promise.all((await testAccounts()).map(async (credentials) => {
  const api = client();
  const { user } = success(await api.auth.signInWithPassword(credentials), "sign in");
  return { api, id: user.id };
}));

const object = success(await manager.api.from("objects").insert({ title: "Workflow smoke test", address: "Test address" }).select("id").single(), "create test object");

async function createTask(mode, ids = []) {
  return success(await manager.api.rpc("save_task", {
    p_task_id: null,
    p_title: `Workflow ${mode}`,
    p_description: "Temporary integration test",
    p_object_id: object.id,
    p_assignment_mode: mode,
    p_assignee_id: null,
    p_candidate_ids: ids,
  }), `create ${mode} task`);
}

const readTask = async ({ api }, id) => success(await api.from("tasks").select("id,assignee_id,status").eq("id", id).maybeSingle(), "read task");
const readObject = async ({ api }) => success(await api.from("objects").select("id").eq("id", object.id).maybeSingle(), "read object");
const addComment = async ({ api }, id, body) => api.from("task_comments").insert({ task_id: id, body });
const bucket = ({ api }) => api.storage.from("task-attachments");
const put = (actor, path) => bucket(actor).upload(path, new Blob(["Report"], { type: "text/plain" }), { upsert: false, cacheControl: "0" });

try {
  const taskId = await createTask("candidates", [first.id, second.id]);
  assert.equal((await readTask(first, taskId)).assignee_id, null);
  assert(await readTask(second, taskId));
  assert(await readObject(first));
  assert(await readObject(second));
  const filename = `${crypto.randomUUID()}_report.txt`;
  const path = `${taskId}/${filename}`;
  assert((await put(first, path)).error, "an unclaimed task cannot receive a performer upload");
  success(await addComment(first, taskId, "Ready to take this task"), "comment on available task");

  const actors = [first, second];
  const claims = await Promise.all(actors.map(({ api }) => api.rpc("claim_task", { p_task_id: taskId })));
  assert.equal(claims.filter((claim) => claim.error === null).length, 1, JSON.stringify(claims.map((claim) => claim.error?.message)));
  const [winner, other] = claims[0].error ? [second, first] : [first, second];
  assert.deepEqual(await readTask(winner, taskId), { id: taskId, assignee_id: winner.id, status: "in_progress" });
  assert.equal(await readTask(other, taskId), null);
  assert.equal(await readObject(other), null);
  assert((await addComment(other, taskId, "Foreign comment")).error);
  assert.deepEqual(success(await other.api.from("task_comments").select("id").eq("task_id", taskId), "check foreign comment visibility"), []);
  assert.deepEqual(success(await other.api.from("task_status_history").select("id").eq("task_id", taskId), "check foreign history visibility"), []);

  success(await put(winner, path), "upload report");
  const items = success(await bucket(manager).list(taskId), "manager lists reports");
  assert(items.some((item) => item.name === filename));
  const report = success(await bucket(manager).download(path, {}, { cache: "no-store" }), "manager downloads report");
  assert.equal(await report.text(), "Report");
  assert.deepEqual(success(await bucket(other).list(taskId), "foreign list is empty"), []);
  assert((await bucket(other).download(path, {}, { cache: "no-store" })).error, "foreign download is denied");
  assert((await bucket(manager).createSignedUrl(path, 3600)).error, "shareable signed links are denied");
  assert((await bucket(manager).createSignedUploadUrl(`${taskId}/${crypto.randomUUID()}_signed.txt`)).error, "signed upload URLs are denied");

  success(await winner.api.rpc("transition_task", { p_task_id: taskId, p_to_status: "in_review" }), "submit report");
  success(await addComment(manager, taskId, "I can read the report"), "manager comment in review");
  const history = success(await manager.api.from("task_status_history").select("to_status").eq("task_id", taskId).order("id"), "read history");
  assert.deepEqual(history.map((row) => row.to_status), ["new", "in_progress", "in_review"]);

  const openTaskId = await createTask("open");
  assert(await readTask(other, openTaskId));
  success(await other.api.rpc("claim_task", { p_task_id: openTaskId }), "claim general task");
  assert.equal(await readTask(winner, openTaskId), null);
  console.log("CRM workflow passed: concurrent claim, scoped comments, private attachments, review, and general task.");
} finally {
  success(await manager.api.rpc("delete_object", { p_object_id: object.id }), "archive test object");
}

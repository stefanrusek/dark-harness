// Test fixture for workflow.test.ts — a script whose default export always rejects.
export default async function () {
  throw new Error("script exploded");
}

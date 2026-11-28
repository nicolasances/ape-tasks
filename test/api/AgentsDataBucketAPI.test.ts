import assert from "assert";
import { Storage } from "@google-cloud/storage";
import { AgentsDataBucketAPI } from "../../src/api/AgentsDataBucketAPI";

/**
 * Fake GCS client: records the bucket, object path, data and options of each save.
 */
function fakeStorage(saves: any[]): Storage {

    return {
        bucket: (bucketName: string) => ({
            file: (path: string) => ({
                save: async (data: string, options: any) => { saves.push({ bucketName, path, data, options }); },
            }),
        }),
    } as unknown as Storage;
}

describe("AgentsDataBucketAPI.writeTaskFile", () => {

    it("writes task.json as JSON to {projectId}-agents-data/{prefix}/{taskId}/ and returns its gs:// URI", async () => {

        const saves: any[] = [];
        const bucketAPI = new AgentsDataBucketAPI({ projectId: "totoexperiments", storage: fakeStorage(saves) });

        const taskFile = await bucketAPI.writeTaskFile({ bucketPrefix: "coder", taskId: "t-1", content: { taskId: "t-1", repoURL: "r", issueURL: "i" } });

        assert.strictEqual(taskFile, "gs://totoexperiments-agents-data/coder/t-1/task.json");
        assert.strictEqual(saves.length, 1);
        assert.strictEqual(saves[0].bucketName, "totoexperiments-agents-data");
        assert.strictEqual(saves[0].path, "coder/t-1/task.json");
        assert.deepStrictEqual(JSON.parse(saves[0].data), { taskId: "t-1", repoURL: "r", issueURL: "i" });
        assert.strictEqual(saves[0].options.contentType, "application/json");
    });

    it("refuses to be created without a project id", () => {

        assert.throws(() => new AgentsDataBucketAPI({ projectId: "", storage: fakeStorage([]) }), /GCP_PID/);
    });
});

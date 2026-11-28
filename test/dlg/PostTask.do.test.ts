import assert from "assert";
import { Request } from "express";
import { MessageDestination, TotoControllerConfig, TotoMessage, TotoMessageBus } from "totoms";
import { AgentsDataBucketAPI, WriteTaskFileInput } from "../../src/api/AgentsDataBucketAPI";
import { PostTask } from "../../src/dlg/PostTask";

/**
 * Fake bucket that records the Task Files written, and the order of operations in a shared log.
 */
class FakeAgentsDataBucket {

    writes: WriteTaskFileInput[] = [];      // Task Files written, in order.
    log: string[];                          // Shared log of operations ("write", "publish").
    failWith?: Error;                       // If set, every write fails with this error.

    constructor({ log, failWith }: { log: string[], failWith?: Error }) {

        this.log = log;
        this.failWith = failWith;
    }

    /**
     * Records the write, or fails if configured to.
     */
    async writeTaskFile(input: WriteTaskFileInput): Promise<string> {

        if (this.failWith) throw this.failWith;

        this.writes.push(input);
        this.log.push("write");

        return `gs://pid-agents-data/${input.bucketPrefix}/${input.taskId}/task.json`;
    }
}

/**
 * Fake message bus that records published messages, and the order of operations in a shared log.
 */
class FakeMessageBus {

    published: { destination: MessageDestination, message: TotoMessage }[] = [];      // Messages published, in order.
    log: string[];                                                                    // Shared log of operations ("write", "publish").

    constructor({ log }: { log: string[] }) {

        this.log = log;
    }

    /**
     * Records the published message.
     */
    async publishMessage(destination: MessageDestination, message: TotoMessage): Promise<void> {

        this.published.push({ destination, message });
        this.log.push("publish");
    }
}

/**
 * Runs a request through parseRequest and do, like the totoms controller does.
 */
async function postTask(delegate: PostTask, body: any) {

    return delegate.processRequest(delegate.parseRequest({ body } as Request));
}

describe("PostTask.do", () => {

    const codingBody = { type: "coding", payload: { repoURL: "https://github.com/a/b.git", issueURL: "https://github.com/a/b/issues/3" } };

    it("writes the Task File under the coder/ prefix with exactly agent-coder's TaskSpec", async () => {

        const log: string[] = [];
        const bucket = new FakeAgentsDataBucket({ log });
        const delegate = new PostTask(new FakeMessageBus({ log }) as unknown as TotoMessageBus, {} as TotoControllerConfig, bucket as unknown as AgentsDataBucketAPI);

        const response = await postTask(delegate, codingBody);

        assert.strictEqual(bucket.writes.length, 1);
        assert.strictEqual(bucket.writes[0].bucketPrefix, "coder");
        assert.strictEqual(bucket.writes[0].taskId, response.taskId);
        assert.deepStrictEqual(bucket.writes[0].content, { taskId: response.taskId, repoURL: "https://github.com/a/b.git", issueURL: "https://github.com/a/b/issues/3" });
    });

    it("writes baseBranch in the Task File when it is sent", async () => {

        const log: string[] = [];
        const bucket = new FakeAgentsDataBucket({ log });
        const delegate = new PostTask(new FakeMessageBus({ log }) as unknown as TotoMessageBus, {} as TotoControllerConfig, bucket as unknown as AgentsDataBucketAPI);

        await postTask(delegate, { type: "coding", payload: { repoURL: "r", issueURL: "i", baseBranch: "develop" } });

        assert.strictEqual(bucket.writes[0].content.baseBranch, "develop");
    });

    it("publishes a taskRequested message with the taskId on the agentCoderTasks topic", async () => {

        const log: string[] = [];
        const bus = new FakeMessageBus({ log });
        const delegate = new PostTask(bus as unknown as TotoMessageBus, {} as TotoControllerConfig, new FakeAgentsDataBucket({ log }) as unknown as AgentsDataBucketAPI);

        const response = await postTask(delegate, codingBody);

        assert.strictEqual(bus.published.length, 1);
        assert.strictEqual(bus.published[0].destination.topic, "agentCoderTasks");
        assert.strictEqual(bus.published[0].message.type, "taskRequested");
        assert.strictEqual(bus.published[0].message.id, response.taskId);
        assert.deepStrictEqual(bus.published[0].message.data, { taskId: response.taskId });
    });

    it("writes the Task File before publishing the message", async () => {

        const log: string[] = [];
        const delegate = new PostTask(new FakeMessageBus({ log }) as unknown as TotoMessageBus, {} as TotoControllerConfig, new FakeAgentsDataBucket({ log }) as unknown as AgentsDataBucketAPI);

        await postTask(delegate, codingBody);

        assert.deepStrictEqual(log, ["write", "publish"]);
    });

    it("responds with the minted taskId (a UUID) and the Task File URI", async () => {

        const log: string[] = [];
        const delegate = new PostTask(new FakeMessageBus({ log }) as unknown as TotoMessageBus, {} as TotoControllerConfig, new FakeAgentsDataBucket({ log }) as unknown as AgentsDataBucketAPI);

        const response = await postTask(delegate, codingBody);

        assert.match(response.taskId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        assert.strictEqual(response.taskFile, `gs://pid-agents-data/coder/${response.taskId}/task.json`);
    });

    it("mints a different taskId for each request", async () => {

        const log: string[] = [];
        const delegate = new PostTask(new FakeMessageBus({ log }) as unknown as TotoMessageBus, {} as TotoControllerConfig, new FakeAgentsDataBucket({ log }) as unknown as AgentsDataBucketAPI);

        const first = await postTask(delegate, codingBody);
        const second = await postTask(delegate, codingBody);

        assert.notStrictEqual(first.taskId, second.taskId);
    });

    it("fails and publishes nothing when the Task File write fails", async () => {

        const log: string[] = [];
        const bus = new FakeMessageBus({ log });
        const delegate = new PostTask(bus as unknown as TotoMessageBus, {} as TotoControllerConfig, new FakeAgentsDataBucket({ log, failWith: new Error("403 Forbidden") }) as unknown as AgentsDataBucketAPI);

        await assert.rejects(postTask(delegate, codingBody), /403 Forbidden/);

        assert.strictEqual(bus.published.length, 0);
    });
});

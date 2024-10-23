import { assert } from "@std/assert";
import { SftpClient } from "./SftpClient.ts";

Deno.test("SftpClient connect & exit", async () => {
    const sftpClient = new SftpClient({
        cwd: "playground",
        host: "maya-dev",
        uploaderName: "with_puppet_process",
    });

    await sftpClient.close();

    assert("closing sftp client was successful");
});

// TODO: add tests for logMode

import { assert, assertEquals } from "@std/assert";
import { SftpClient } from "../with_execa/SftpClient.ts";

Deno.test("SftpClient connect & exit", async () => {
    const sftpClient = new SftpClient({
        cwd: "playground",
        host: "maya-dev",
        uploaderName: "test_1",
    });

    const result = await sftpClient.close();

    const clientOut = result?.all;
    assert(clientOut);
    assertEquals(clientOut, "Connected to maya-dev.\nsftp> exit ");
});

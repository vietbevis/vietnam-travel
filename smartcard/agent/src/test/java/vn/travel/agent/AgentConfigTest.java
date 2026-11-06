package vn.travel.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AgentConfigTest {
    @TempDir Path dir;

    @Test
    void configSimFlag() throws Exception {
        Path f = dir.resolve("agent.properties");
        Files.writeString(f, "port=4000\nmode=pcsc\nallowedOrigins= http://a.test , http://b.test\n");
        AgentConfig c = AgentConfig.load(f, new String[] {"--sim"});
        assertEquals("sim", c.mode());
        assertEquals(4000, c.port());
        assertEquals(Set.of("http://a.test", "http://b.test"), c.allowedOrigins());
        assertEquals(5000, AgentConfig.load(f, new String[] {"--port=5000"}).port());
        assertEquals("pcsc", AgentConfig.load(f, new String[0]).mode());
    }

    @Test
    void missingFileUsesDefaults() {
        AgentConfig c = AgentConfig.load(dir.resolve("none.properties"), new String[0]);
        assertEquals(31999, c.port());
        assertEquals("pcsc", c.mode());
        assertNull(c.reader());
    }
}

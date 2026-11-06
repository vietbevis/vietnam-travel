package vn.travel.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class AgentHttpServerTest {
    static final String SELECT = "00A4040008F054524156454C01";
    static final String ORIGIN = "http://localhost:3000";

    final HttpClient http = HttpClient.newHttpClient();
    AgentHttpServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop();
        }
    }

    void start(CardPort port) throws Exception {
        server = new AgentHttpServer(new AgentConfig(0, Set.of(ORIGIN), port.mode(), null), port);
        server.start();
    }

    void startSim() throws Exception {
        start(new SimCardPort(4));
    }

    HttpResponse<String> call(String method, String path, String body, String origin) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + server.boundPort() + path));
        if (origin != null) {
            // Header Origin bị HttpClient hạn chế mặc định nên đặt qua thuộc tính hệ thống (xem static block).
            b.header("Origin", origin);
        }
        b.method(method, body == null ? BodyPublishers.noBody() : BodyPublishers.ofString(body));
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    static {
        System.setProperty("jdk.httpclient.allowRestrictedHeaders", "origin,host");
    }

    HttpResponse<String> post(String path, String body) throws Exception {
        return call("POST", path, body, null);
    }

    static JsonObject json(HttpResponse<String> r) {
        return JsonParser.parseString(r.body()).getAsJsonObject();
    }

    static String apdus(String... a) {
        JsonArray arr = new JsonArray();
        for (String s : a) {
            arr.add(s);
        }
        JsonObject o = new JsonObject();
        o.add("apdus", arr);
        return o.toString();
    }

    @Test
    void status() throws Exception {
        startSim();
        HttpResponse<String> r = call("GET", "/v1/status", null, null);
        assertEquals(200, r.statusCode());
        JsonObject o = json(r);
        assertEquals("sim", o.get("mode").getAsString());
        assertTrue(o.get("cardPresent").getAsBoolean());
        assertEquals(0, o.get("slot").getAsInt());
    }

    @Test
    void transmit() throws Exception {
        startSim();
        HttpResponse<String> r = post("/v1/transmit", apdus(SELECT, "8010000000"));
        assertEquals(200, r.statusCode());
        JsonArray resp = json(r).getAsJsonArray("responses");
        assertEquals("9000", resp.get(1).getAsJsonObject().get("sw").getAsString());
        assertEquals(42, resp.get(1).getAsJsonObject().get("data").getAsString().length());
    }

    @Test
    void transmitStopsOnError() throws Exception {
        startSim();
        HttpResponse<String> r = post("/v1/transmit", apdus(SELECT, "807E000000", "8010000000"));
        JsonArray resp = json(r).getAsJsonArray("responses");
        assertEquals(2, resp.size());
        assertEquals("6D00", resp.get(1).getAsJsonObject().get("sw").getAsString());
    }

    @Test
    void badRequests() throws Exception {
        startSim();
        List<String> bodies = new ArrayList<>();
        bodies.add("không phải json {");
        bodies.add("[]");
        bodies.add("{\"apdus\":[]}");
        bodies.add("{}");
        bodies.add(apdus(Collections.nCopies(65, "80100000").toArray(new String[0])));
        bodies.add(apdus("801"));
        bodies.add(apdus("80GG0000"));
        bodies.add(apdus("801000"));
        bodies.add(apdus("80" + "10" + "00".repeat(260))); // 262 byte
        bodies.add("{\"apdus\":[123]}");
        bodies.add(apdus("00A4040008F054")); // Lc=8 nhưng chỉ có 1 byte dữ liệu
        for (String b : bodies) {
            HttpResponse<String> r = post("/v1/transmit", b);
            assertEquals(400, r.statusCode(), b);
            assertEquals("bad-request", json(r).get("error").getAsString());
        }
    }

    @Test
    void boundarySizesAccepted() throws Exception {
        // Cổng giả, vì jCardSim không phân tích được APDU 261 byte tùy ý.
        start(new FakePort("pcsc", batch -> List.of(new byte[] {(byte) 0x90, 0})));
        assertEquals(200, post("/v1/transmit", apdus("80100000FF" + "00".repeat(255) + "00")).statusCode());
        assertEquals(200, post("/v1/transmit", apdus(Collections.nCopies(64, "80100000").toArray(new String[0]))).statusCode());
    }

    @Test
    void foreignOriginRejected() throws Exception {
        startSim();
        HttpResponse<String> r = call("GET", "/v1/status", null, "https://evil.example");
        assertEquals(403, r.statusCode());
        assertEquals("origin", json(r).get("error").getAsString());
        assertEquals(403, call("OPTIONS", "/v1/transmit", null, "https://evil.example").statusCode());
    }

    @Test
    void allowedOriginCors() throws Exception {
        startSim();
        HttpResponse<String> r = call("GET", "/v1/status", null, ORIGIN);
        assertEquals(200, r.statusCode());
        assertEquals(ORIGIN, r.headers().firstValue("Access-Control-Allow-Origin").orElse(null));
        HttpResponse<String> o = call("OPTIONS", "/v1/transmit", null, ORIGIN);
        assertEquals(204, o.statusCode());
        assertEquals("true", o.headers().firstValue("Access-Control-Allow-Private-Network").orElse(null));
        assertEquals("GET, POST", o.headers().firstValue("Access-Control-Allow-Methods").orElse(null));
    }

    @Test
    void simSlotEndpoints() throws Exception {
        startSim();
        assertEquals(2, json(post("/v1/sim/slot", "{\"slot\":2}")).get("slot").getAsInt());
        assertEquals(2, json(call("GET", "/v1/status", null, null)).get("slot").getAsInt());
        assertEquals(400, post("/v1/sim/slot", "{\"slot\":9}").statusCode());
        assertEquals(200, post("/v1/sim/reset", "{\"slot\":2}").statusCode());
    }

    @Test
    void simEndpointsAbsentInPcsc() throws Exception {
        start(new FakePort("pcsc", apdus -> List.of(new byte[] {(byte) 0x90, 0})));
        assertEquals(404, post("/v1/sim/slot", "{\"slot\":1}").statusCode());
        assertEquals(404, post("/v1/sim/reset", "{\"slot\":1}").statusCode());
    }

    @Test
    void noCardIs503() throws Exception {
        start(new FakePort("pcsc", apdus -> {
            throw new NoCardException("no card");
        }));
        HttpResponse<String> r = post("/v1/transmit", apdus("80100000"));
        assertEquals(503, r.statusCode());
        assertEquals("no-card", json(r).get("error").getAsString());
    }

    @Test
    void concurrentBatchesDoNotInterleave() throws Exception {
        List<String> seen = Collections.synchronizedList(new ArrayList<>());
        start(new FakePort("pcsc", batch -> {
            List<byte[]> out = new ArrayList<>();
            for (byte[] a : batch) {
                seen.add(Hex.encode(new byte[] {a[2]}));
                try {
                    Thread.sleep(5);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                out.add(new byte[] {(byte) 0x90, 0x00});
            }
            return out;
        }));
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<Integer>> fs = new ArrayList<>();
            for (String tag : new String[] {"AA", "BB"}) {
                String[] batch = new String[10];
                java.util.Arrays.fill(batch, "8010" + tag + "00");
                Callable<Integer> c = () -> post("/v1/transmit", apdus(batch)).statusCode();
                fs.add(pool.submit(c));
            }
            for (Future<Integer> f : fs) {
                assertEquals(200, f.get());
            }
        } finally {
            pool.shutdownNow();
        }
        assertEquals(20, seen.size());
        String first = seen.get(0);
        for (int i = 0; i < 10; i++) {
            assertEquals(first, seen.get(i));
        }
        String second = seen.get(10);
        assertTrue(!second.equals(first));
        for (int i = 10; i < 20; i++) {
            assertEquals(second, seen.get(i));
        }
    }

    interface Batch {
        List<byte[]> run(List<byte[]> apdus) throws NoCardException;
    }

    /** Cổng thẻ giả không có khóa riêng, để kiểm chứng khóa tuần tự nằm ở server. */
    record FakePort(String mode, Batch batch) implements CardPort {
        public List<byte[]> transmitBatch(List<byte[]> apdus) throws NoCardException {
            return batch.run(apdus);
        }

        public String readerName() {
            return "fake";
        }

        public boolean cardPresent() {
            return true;
        }

        public Integer slot() {
            return null;
        }
    }

    /** Cổng giả trả về phản hồi ngắn và tên đầu đọc null. */
    static final class StubPort implements CardPort {
        public List<byte[]> transmitBatch(List<byte[]> a) {
            return List.of(new byte[] {0x61});
        }
        public String readerName() { return null; }
        public boolean cardPresent() { return true; }
        public Integer slot() { return null; }
        public String mode() { return "pcsc"; }
    }

    @Test
    void wrongHostRejected() throws Exception {
        startSim();
        for (String h : new String[] {"evil.example", "evil.example:" + server.boundPort(), "127.0.0.1:1"}) {
            HttpRequest r = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + server.boundPort() + "/v1/status"))
                    .header("Host", h).build();
            assertEquals(403, http.send(r, HttpResponse.BodyHandlers.ofString()).statusCode(), h);
        }
        HttpRequest ok = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + server.boundPort() + "/v1/status"))
                .header("Host", "localhost:" + server.boundPort()).build();
        assertEquals(200, http.send(ok, HttpResponse.BodyHandlers.ofString()).statusCode());
    }

    @Test
    void oversizedBodyIs400() throws Exception {
        startSim();
        String big = "{\"apdus\":[\"" + "A".repeat(AgentHttpServer.MAX_BODY + 10) + "\"]}";
        assertEquals(400, post("/v1/transmit", big).statusCode());
    }

    @Test
    void shortResponseIs500AndNullReaderIsEmpty() throws Exception {
        start(new StubPort());
        assertEquals("", json(call("GET", "/v1/status", null, null)).get("reader").getAsString());
        assertEquals(500, post("/v1/transmit", apdus(SELECT)).statusCode());
    }
}

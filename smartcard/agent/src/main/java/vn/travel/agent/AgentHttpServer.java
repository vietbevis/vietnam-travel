package vn.travel.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.locks.ReentrantLock;

/** Cầu HTTP trên localhost giữa trình duyệt và thẻ (xem spec mục 4). */
public final class AgentHttpServer {
    static final int MAX_BODY = 64 * 1024;
    static final int MAX_APDUS = 64;
    static final int MIN_APDU_LEN = 4;
    static final int MAX_APDU_LEN = 261;

    private final AgentConfig cfg;
    private final CardPort port;
    /** Khóa tuần tự cho mọi thao tác với thẻ, để hai batch không bao giờ xen kẽ nhau. */
    private final ReentrantLock cardLock = new ReentrantLock();
    private HttpServer server;
    private ExecutorService executor;

    public AgentHttpServer(AgentConfig cfg, CardPort port) {
        this.cfg = cfg;
        this.port = port;
    }

    public void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), cfg.port()), 0);
        executor = Executors.newFixedThreadPool(8);
        server.setExecutor(executor);
        server.createContext("/", this::handle);
        server.start();
    }

    public void stop() {
        if (server != null) {
            server.stop(0);
        }
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    public int boundPort() {
        return server.getAddress().getPort();
    }

    /** Thứ tự xử lý: kiểm Origin, xử lý OPTIONS, rồi định tuyến. */
    private void handle(HttpExchange ex) throws IOException {
        try {
            String origin = ex.getRequestHeaders().getFirst("Origin");
            if (origin != null) {
                if (!cfg.allowedOrigins().contains(origin)) {
                    send(ex, 403, error("origin"));
                    return;
                }
                ex.getResponseHeaders().set("Access-Control-Allow-Origin", origin);
                ex.getResponseHeaders().set("Vary", "Origin");
            }
            String method = ex.getRequestMethod();
            if (method.equals("OPTIONS")) {
                var h = ex.getResponseHeaders();
                h.set("Access-Control-Allow-Methods", "GET, POST");
                h.set("Access-Control-Allow-Headers", "Content-Type");
                h.set("Access-Control-Allow-Private-Network", "true");
                ex.sendResponseHeaders(204, -1);
                return;
            }
            route(ex, method, ex.getRequestURI().getPath());
        } catch (Handled e) {
            // đã trả lời
        } catch (BadRequest e) {
            send(ex, 400, error("bad-request"));
        } catch (NoCardException e) {
            send(ex, 503, error("no-card"));
        } catch (Exception e) {
            // Không ghi nội dung APDU; chỉ ghi loại lỗi.
            System.err.println("internal error: " + e.getClass().getSimpleName());
            send(ex, 500, error("internal"));
        } finally {
            ex.close();
        }
    }

    private void route(HttpExchange ex, String method, String path) throws Exception {
        switch (path) {
            case "/v1/status" -> {
                requireMethod(ex, method, "GET");
                JsonObject o = new JsonObject();
                o.addProperty("mode", port.mode());
                o.addProperty("reader", port.readerName());
                o.addProperty("cardPresent", port.cardPresent());
                Integer slot = port.slot();
                o.add("slot", slot == null ? JsonNull.INSTANCE : new com.google.gson.JsonPrimitive(slot));
                send(ex, 200, o.toString());
            }
            case "/v1/transmit" -> {
                requireMethod(ex, method, "POST");
                transmit(ex);
            }
            case "/v1/sim/slot", "/v1/sim/reset" -> {
                if (!(port instanceof SimCardPort sim) || !"sim".equals(port.mode())) {
                    send(ex, 404, error("not-found"));
                    return;
                }
                requireMethod(ex, method, "POST");
                int slot = readSlot(ex);
                cardLock.lock();
                try {
                    if (path.endsWith("/slot")) {
                        sim.selectSlot(slot);
                    } else {
                        sim.resetSlot(slot);
                    }
                } catch (IllegalArgumentException e) {
                    throw new BadRequest();
                } finally {
                    cardLock.unlock();
                }
                JsonObject o = new JsonObject();
                o.addProperty("slot", slot);
                send(ex, 200, o.toString());
            }
            default -> send(ex, 404, error("not-found"));
        }
    }

    private void requireMethod(HttpExchange ex, String actual, String expected) throws IOException {
        if (!actual.equals(expected)) {
            ex.getResponseHeaders().set("Allow", expected);
            send(ex, 405, error("method"));
            throw new Handled();
        }
    }

    private int readSlot(HttpExchange ex) throws IOException {
        JsonObject o = readJsonObject(ex);
        JsonElement e = o.get("slot");
        if (e == null || !e.isJsonPrimitive() || !e.getAsJsonPrimitive().isNumber()) {
            throw new BadRequest();
        }
        try {
            return e.getAsBigDecimal().intValueExact();
        } catch (ArithmeticException ex2) {
            throw new BadRequest();
        }
    }

    private void transmit(HttpExchange ex) throws IOException, NoCardException {
        JsonObject o = readJsonObject(ex);
        JsonElement arr = o.get("apdus");
        if (arr == null || !arr.isJsonArray()) {
            throw new BadRequest();
        }
        JsonArray a = arr.getAsJsonArray();
        if (a.size() < 1 || a.size() > MAX_APDUS) {
            throw new BadRequest();
        }
        List<byte[]> apdus = new ArrayList<>();
        for (JsonElement el : a) {
            if (!el.isJsonPrimitive() || !el.getAsJsonPrimitive().isString()) {
                throw new BadRequest();
            }
            byte[] b;
            try {
                b = Hex.decode(el.getAsString());
            } catch (IllegalArgumentException e) {
                throw new BadRequest();
            }
            if (b.length < MIN_APDU_LEN || b.length > MAX_APDU_LEN) {
                throw new BadRequest();
            }
            apdus.add(b);
        }
        List<byte[]> resps;
        cardLock.lock();
        try {
            resps = port.transmitBatch(apdus);
        } finally {
            cardLock.unlock();
        }
        JsonArray out = new JsonArray();
        for (int i = 0; i < resps.size(); i++) {
            byte[] r = resps.get(i);
            JsonObject item = new JsonObject();
            String sw;
            String data;
            if (r.length >= 2) {
                data = Hex.encode(Arrays.copyOfRange(r, 0, r.length - 2));
                sw = Hex.encode(Arrays.copyOfRange(r, r.length - 2, r.length));
            } else {
                data = "";
                sw = "6F00";
            }
            item.addProperty("data", data);
            item.addProperty("sw", sw);
            out.add(item);
            // Chỉ ghi INS và SW, tuyệt đối không ghi byte dữ liệu.
            System.out.printf("INS=%02X SW=%s%n", i < apdus.size() ? apdus.get(i)[1] & 0xFF : 0, sw);
        }
        JsonObject res = new JsonObject();
        res.add("responses", out);
        send(ex, 200, res.toString());
    }

    private JsonObject readJsonObject(HttpExchange ex) throws IOException {
        byte[] body;
        try (InputStream in = ex.getRequestBody()) {
            body = in.readNBytes(MAX_BODY + 1);
        }
        if (body.length > MAX_BODY) {
            throw new BadRequest();
        }
        try {
            JsonElement e = JsonParser.parseString(new String(body, StandardCharsets.UTF_8));
            if (!e.isJsonObject()) {
                throw new BadRequest();
            }
            return e.getAsJsonObject();
        } catch (RuntimeException e) {
            if (e instanceof BadRequest br) {
                throw br;
            }
            throw new BadRequest();
        }
    }

    private static String error(String code) {
        JsonObject o = new JsonObject();
        o.addProperty("error", code);
        return o.toString();
    }

    private void send(HttpExchange ex, int status, String json) throws IOException {
        byte[] b = json.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.sendResponseHeaders(status, b.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(b);
        }
    }

    /** Yêu cầu không hợp lệ (ánh xạ sang 400). */
    private static final class BadRequest extends RuntimeException {
        BadRequest() {
            super(null, null, false, false);
        }
    }

    /** Đã trả lời xong, dừng xử lý tiếp. */
    private static final class Handled extends RuntimeException {
        Handled() {
            super(null, null, false, false);
        }
    }
}

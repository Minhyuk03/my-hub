// 허브 캘린더 도우미: Mac 캘린더 앱(EventKit)의 앞으로 며칠 일정을 JSON 파일로 쓴다.
// 사용: open -g -j -n -W HubCalendar.app --args --out <파일> --days 7
// 일정을 읽기만 하고 바꾸지 않는다.
import AppKit
import EventKit
import Foundation

let args = CommandLine.arguments
func arg(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}
let outPath = arg("--out") ?? (NSTemporaryDirectory() + "hub-calendar.json")
let days = Int(arg("--days") ?? "7") ?? 7

func hex(_ c: CGColor?) -> String {
    guard let c = c, let rgb = NSColor(cgColor: c)?.usingColorSpace(.sRGB) else { return "" }
    return String(format: "#%02x%02x%02x", Int(rgb.redComponent * 255), Int(rgb.greenComponent * 255), Int(rgb.blueComponent * 255))
}

func write(_ obj: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: obj) {
        FileManager.default.createFile(atPath: outPath, contents: data, attributes: [.posixPermissions: 0o600])
    }
    exit(0)
}

let store = EKEventStore()
func dump() {
    let cal = Calendar.current
    let start = cal.startOfDay(for: Date())
    let end = cal.date(byAdding: .day, value: days, to: start)!
    let calendars = store.calendars(for: .event)
    let pred = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
    let events = store.events(matching: pred).sorted { $0.startDate < $1.startDate }.map { e -> [String: Any] in
        var o: [String: Any] = [
            "title": e.title ?? "(제목 없음)",
            "start": Int(e.startDate.timeIntervalSince1970 * 1000),
            "end": Int(e.endDate.timeIntervalSince1970 * 1000),
            "allDay": e.isAllDay,
            "calendar": e.calendar.title,
            "color": hex(e.calendar.cgColor),
        ]
        if let l = e.location, !l.isEmpty { o["location"] = l }
        return o
    }
    write([
        "status": "ok",
        "calendars": calendars.map { ["title": $0.title, "color": hex($0.cgColor), "source": $0.source.title] },
        "events": events,
    ])
}

store.requestFullAccessToEvents { granted, error in
    if granted { dump() }
    write(["status": "denied", "message": error?.localizedDescription ?? "캘린더 접근이 허용되지 않았습니다", "calendars": [], "events": []])
}
// 권한 창에 답할 때까지 기다린다 (최대 2분)
DispatchQueue.main.asyncAfter(deadline: .now() + 120) {
    write(["status": "error", "message": "시간 초과", "calendars": [], "events": []])
}
RunLoop.main.run()

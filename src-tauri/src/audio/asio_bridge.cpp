#include "asio_bridge.h"

#include <algorithm>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

#include "asiosys.h"
#include "asio.h"
#include "asiodrivers.h"
#include "iasiodrv.h"

extern bool loadAsioDriver(char *name);
extern AsioDrivers *asioDrivers;

namespace {

constexpr int32_t kStatusReset = 1;
constexpr int32_t kStatusResync = 2;
constexpr int32_t kStatusOverload = 3;
constexpr int32_t kStatusSampleRateChanged = 4;

std::mutex g_asio_mutex;

void write_error(char *dst, int32_t capacity, const char *message) {
    if (!dst || capacity <= 0) {
        return;
    }
    const char *source = message ? message : "Unknown ASIO error";
    std::strncpy(dst, source, static_cast<size_t>(capacity - 1));
    dst[capacity - 1] = 0;
}

void write_error(char *dst, int32_t capacity, const std::string &message) {
    write_error(dst, capacity, message.c_str());
}

std::string asio_error_text(ASIOError error, const ASIODriverInfo *info = nullptr) {
    if (info && info->errorMessage[0]) {
        return std::string(info->errorMessage);
    }
    switch (error) {
    case ASE_NotPresent:
        return "ASIO driver or device is not present";
    case ASE_HWMalfunction:
        return "ASIO hardware malfunction";
    case ASE_InvalidParameter:
        return "ASIO invalid parameter";
    case ASE_InvalidMode:
        return "ASIO invalid mode";
    case ASE_NoClock:
        return "ASIO sample clock/rate is unavailable";
    case ASE_NoMemory:
        return "ASIO driver could not allocate buffers";
    default:
        return "ASIO error " + std::to_string(static_cast<long>(error));
    }
}

bool asio_success(ASIOError error) {
    return error == ASE_OK || error == ASE_SUCCESS;
}

struct Session {
    ng_asio_fill_fn fill = nullptr;
    ng_asio_status_fn status = nullptr;
    void *user = nullptr;
    std::vector<ASIOBufferInfo> buffers;
    std::vector<void *> callback_buffers;
    ASIOCallbacks callbacks{};
    long bytes_per_channel = 0;
    long output_channels = 0;
    ASIOSampleType sample_type = ASIOSTDSDInt8MSB1;
    bool buffers_created = false;
    bool started = false;
};

Session *g_callback_session = nullptr;

void on_buffer_switch(long index, ASIOBool /*direct_process*/) {
    // ASIO is process-global. The callback's user pointer is the session
    // installed in ASIOCreateBuffers and therefore remains valid until the
    // stream is stopped and its buffers are disposed.
    Session *session = g_callback_session;
    if (!session || !session->fill || index < 0 || index > 1) {
        return;
    }
    for (long channel = 0; channel < session->output_channels; ++channel) {
        session->callback_buffers[static_cast<size_t>(channel)] =
            session->buffers[static_cast<size_t>(channel)].buffers[index];
    }
    session->fill(session->user, session->callback_buffers.data(),
                 static_cast<int32_t>(session->output_channels),
                 static_cast<int32_t>(session->bytes_per_channel));
}

ASIOTime *on_buffer_switch_time_info(ASIOTime *params, long index,
                                     ASIOBool direct_process) {
    on_buffer_switch(index, direct_process);
    return params;
}

void on_sample_rate_changed(ASIOSampleRate /*sample_rate*/) {
    if (g_callback_session && g_callback_session->status) {
        g_callback_session->status(g_callback_session->user,
                                   kStatusSampleRateChanged);
    }
}

long on_asio_message(long selector, long /*value*/, void * /*message*/,
                     double * /*opt*/) {
    if (!g_callback_session || !g_callback_session->status) {
        return 0;
    }
    switch (selector) {
    case kAsioResetRequest:
        g_callback_session->status(g_callback_session->user, kStatusReset);
        return 1;
    case kAsioResyncRequest:
        g_callback_session->status(g_callback_session->user, kStatusResync);
        return 1;
    case kAsioOverload:
        g_callback_session->status(g_callback_session->user, kStatusOverload);
        return 1;
    case kAsioSelectorSupported:
        return 0;
    default:
        return 0;
    }
}

bool load_driver(const char *name, char *error, int32_t error_capacity) {
    if (!name || !name[0]) {
        write_error(error, error_capacity, "No ASIO driver was selected");
        return false;
    }

    // loadAsioDriver is the SDK's Windows helper. It resolves the registry
    // description to the driver's COM class and installs the SDK global.
    char mutable_name[256]{};
    std::strncpy(mutable_name, name, sizeof(mutable_name) - 1);
    if (!loadAsioDriver(mutable_name)) {
        // The SDK helper compares against a 32-byte display-name buffer. Find
        // the full registry name first, then retry with the same short name
        // that the helper uses, so long driver descriptions still work.
        if (asioDrivers) {
            for (long index = 0; index < asioDrivers->asioGetNumDev(); ++index) {
                char full_name[256]{};
                if (asioDrivers->asioGetDriverName(
                        index, full_name, static_cast<int>(sizeof(full_name))) != 0) {
                    continue;
                }
                if (_stricmp(full_name, name) != 0) {
                    continue;
                }
                char short_name[32]{};
                if (asioDrivers->asioGetDriverName(
                        index, short_name, static_cast<int>(sizeof(short_name))) == 0 &&
                    loadAsioDriver(short_name)) {
                    return true;
                }
            }
        }
        write_error(error, error_capacity,
                    "ASIO driver is installed but could not be opened");
        return false;
    }
    return true;
}

bool init_driver(double sample_rate_hz, int32_t requested_channels,
                 ASIOChannelInfo *first_channel, ASIODriverInfo *driver_info,
                 char *error, int32_t error_capacity, ng_asio_info *out_info) {
    if (requested_channels <= 0) {
        write_error(error, error_capacity, "ASIO requires at least one output channel");
        return false;
    }

    ASIODriverInfo info{};
    info.asioVersion = 2;
    info.sysRef = nullptr;
    const ASIOError init_error = ASIOInit(&info);
    if (!asio_success(init_error)) {
        write_error(error, error_capacity, asio_error_text(init_error, &info));
        return false;
    }
    if (driver_info) {
        *driver_info = info;
    }

    long inputs = 0;
    long outputs = 0;
    ASIOError result = ASIOGetChannels(&inputs, &outputs);
    if (!asio_success(result) || outputs < requested_channels) {
        write_error(error, error_capacity,
                    outputs < requested_channels
                        ? "ASIO driver has fewer output channels than the DSD source"
                        : asio_error_text(result));
        ASIOExit();
        return false;
    }

    ASIOIoFormat format{};
    format.FormatType = kASIODSDFormat;
    result = ASIOFuture(kAsioCanDoIoFormat, &format);
    if (!asio_success(result) || format.FormatType != kASIODSDFormat) {
        write_error(error, error_capacity, "ASIO driver does not support native DSD I/O");
        ASIOExit();
        return false;
    }
    format.FormatType = kASIODSDFormat;
    result = ASIOFuture(kAsioSetIoFormat, &format);
    if (!asio_success(result) || format.FormatType != kASIODSDFormat) {
        write_error(error, error_capacity, "ASIO driver rejected native DSD I/O mode");
        ASIOExit();
        return false;
    }

    result = ASIOCanSampleRate(sample_rate_hz);
    if (!asio_success(result)) {
        write_error(error, error_capacity,
                    "ASIO DAC does not support the requested native DSD rate");
        ASIOExit();
        return false;
    }
    result = ASIOSetSampleRate(sample_rate_hz);
    if (!asio_success(result)) {
        write_error(error, error_capacity, asio_error_text(result));
        ASIOExit();
        return false;
    }

    ASIOChannelInfo info_channel{};
    info_channel.channel = 0;
    info_channel.isInput = ASIOFalse;
    result = ASIOGetChannelInfo(&info_channel);
    if (!asio_success(result)) {
        write_error(error, error_capacity, asio_error_text(result));
        ASIOExit();
        return false;
    }
    if (info_channel.type != ASIOSTDSDInt8MSB1 &&
        info_channel.type != ASIOSTDSDInt8LSB1) {
        write_error(error, error_capacity,
                    "ASIO driver selected an unsupported DSD sample type");
        ASIOExit();
        return false;
    }
    if (first_channel) {
        *first_channel = info_channel;
    }

    if (out_info) {
        out_info->output_channels = requested_channels;
        out_info->sample_type = info_channel.type;
        out_info->sample_rate_hz = static_cast<int32_t>(sample_rate_hz);
    }
    return true;
}

bool probe_locked(const char *driver_name, double sample_rate_hz,
                  int32_t *sample_type, char *error, int32_t error_capacity) {
    if (!load_driver(driver_name, error, error_capacity)) {
        return false;
    }
    ASIOChannelInfo first{};
    if (!init_driver(sample_rate_hz, 1, &first, nullptr, error, error_capacity,
                     nullptr)) {
        return false;
    }
    if (sample_type) {
        *sample_type = first.type;
    }
    ASIOExit();
    return true;
}

} // namespace

extern "C" void *ng_asio_open_native(
    const char *driver_name, double sample_rate_hz, int32_t requested_channels,
    ng_asio_fill_fn fill, ng_asio_status_fn status, void *user,
    ng_asio_info *out_info, char *error, int32_t error_capacity) {
    std::lock_guard<std::mutex> lock(g_asio_mutex);
    if (g_callback_session) {
        write_error(error, error_capacity, "Another ASIO stream is already open");
        return nullptr;
    }

    if (!load_driver(driver_name, error, error_capacity)) {
        return nullptr;
    }

    auto *session = new Session();
    session->fill = fill;
    session->status = status;
    session->user = user;
    ASIOChannelInfo first{};
    if (!init_driver(sample_rate_hz, requested_channels, &first, nullptr, error,
                     error_capacity, out_info)) {
        delete session;
        return nullptr;
    }

    long min_size = 0;
    long max_size = 0;
    long preferred_size = 0;
    long granularity = 0;
    ASIOError result = ASIOGetBufferSize(&min_size, &max_size, &preferred_size,
                                         &granularity);
    if (!asio_success(result) || preferred_size <= 0) {
        write_error(error, error_capacity, asio_error_text(result));
        ASIOExit();
        delete session;
        return nullptr;
    }

    session->output_channels = requested_channels;
    session->bytes_per_channel = preferred_size;
    session->sample_type = first.type;
    session->buffers.resize(static_cast<size_t>(requested_channels));
    session->callback_buffers.resize(static_cast<size_t>(requested_channels));
    for (long channel = 0; channel < requested_channels; ++channel) {
        auto &buffer = session->buffers[static_cast<size_t>(channel)];
        buffer.isInput = ASIOFalse;
        buffer.channelNum = channel;
        buffer.buffers[0] = nullptr;
        buffer.buffers[1] = nullptr;
        ASIOChannelInfo channel_info{};
        channel_info.channel = channel;
        channel_info.isInput = ASIOFalse;
        result = ASIOGetChannelInfo(&channel_info);
        if (!asio_success(result) || channel_info.type != session->sample_type) {
            write_error(error, error_capacity,
                        "ASIO output channels do not share one native DSD sample type");
            ASIOExit();
            delete session;
            return nullptr;
        }
    }

    session->callbacks.bufferSwitch = on_buffer_switch;
    session->callbacks.sampleRateDidChange = on_sample_rate_changed;
    session->callbacks.asioMessage = on_asio_message;
    session->callbacks.bufferSwitchTimeInfo = on_buffer_switch_time_info;

    // Install the callback target before CreateBuffers: a few drivers call a
    // callback during buffer preparation.
    g_callback_session = session;
    result = ASIOCreateBuffers(session->buffers.data(), requested_channels,
                               preferred_size, &session->callbacks);
    if (!asio_success(result)) {
        g_callback_session = nullptr;
        write_error(error, error_capacity, asio_error_text(result));
        ASIOExit();
        delete session;
        return nullptr;
    }
    session->buffers_created = true;
    if (out_info) {
        out_info->bytes_per_channel = preferred_size;
    }
    return session;
}

extern "C" int32_t ng_asio_probe_native(const char *driver_name,
                                           double sample_rate_hz,
                                           int32_t *sample_type, char *error,
                                           int32_t error_capacity) {
    std::lock_guard<std::mutex> lock(g_asio_mutex);
    return probe_locked(driver_name, sample_rate_hz, sample_type, error,
                        error_capacity)
               ? 1
               : 0;
}

extern "C" int32_t ng_asio_start(void *opaque, char *error,
                                   int32_t error_capacity) {
    std::lock_guard<std::mutex> lock(g_asio_mutex);
    auto *session = static_cast<Session *>(opaque);
    if (!session || !session->buffers_created) {
        write_error(error, error_capacity, "ASIO session is not initialized");
        return 0;
    }
    const ASIOError result = ASIOStart();
    if (!asio_success(result)) {
        write_error(error, error_capacity, asio_error_text(result));
        return 0;
    }
    session->started = true;
    return 1;
}

extern "C" int32_t ng_asio_stop(void *opaque, char *error,
                                  int32_t error_capacity) {
    std::lock_guard<std::mutex> lock(g_asio_mutex);
    auto *session = static_cast<Session *>(opaque);
    if (!session || !session->started) {
        return 1;
    }
    const ASIOError result = ASIOStop();
    if (!asio_success(result)) {
        write_error(error, error_capacity, asio_error_text(result));
        return 0;
    }
    session->started = false;
    return 1;
}

extern "C" void ng_asio_close(void *opaque) {
    std::lock_guard<std::mutex> lock(g_asio_mutex);
    auto *session = static_cast<Session *>(opaque);
    if (!session) {
        return;
    }
    if (session->started) {
        ASIOStop();
        session->started = false;
    }
    if (session->buffers_created) {
        ASIODisposeBuffers();
        session->buffers_created = false;
    }
    if (g_callback_session == session) {
        g_callback_session = nullptr;
    }
    ASIOExit();
    delete session;
}

#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*ng_asio_fill_fn)(void *user, void **channel_buffers,
                                int32_t channel_count, int32_t bytes_per_channel);
typedef void (*ng_asio_status_fn)(void *user, int32_t code);

typedef struct ng_asio_info {
    int32_t output_channels;
    int32_t bytes_per_channel;
    int32_t sample_type;
    int32_t sample_rate_hz;
} ng_asio_info;

// Returns an opaque session handle. The caller owns the handle and must close
// it with ng_asio_close, even when start fails.
void *ng_asio_open_native(const char *driver_name, double sample_rate_hz,
                          int32_t requested_channels, ng_asio_fill_fn fill,
                          ng_asio_status_fn status, void *user,
                          ng_asio_info *out_info, char *error,
                          int32_t error_capacity);

int32_t ng_asio_probe_native(const char *driver_name, double sample_rate_hz,
                             int32_t *sample_type, char *error,
                             int32_t error_capacity);

int32_t ng_asio_start(void *session, char *error, int32_t error_capacity);
int32_t ng_asio_stop(void *session, char *error, int32_t error_capacity);
void ng_asio_close(void *session);

#ifdef __cplusplus
}
#endif

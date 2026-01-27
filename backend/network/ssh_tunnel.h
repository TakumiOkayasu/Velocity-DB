#pragma once

#include <expected>
#include <memory>
#include <string>

namespace predategrip {

enum class SshAuthMethod { Password, PublicKey };

struct SshTunnelConfig {
    std::string host;
    int port = 22;
    std::string username;
    SshAuthMethod authMethod = SshAuthMethod::Password;
    std::string password;        // For password auth
    std::string privateKeyPath;  // For public key auth
    std::string keyPassphrase;   // For encrypted private keys

    // Tunnel forwarding
    std::string remoteHost;  // Target DB host (from SSH server's perspective)
    int remotePort = 1433;   // Target DB port
};

struct SshTunnelError {
    enum class Code { ConnectionFailed, AuthenticationFailed, TunnelFailed, SocketError, Timeout, Unknown };
    Code code;
    std::string message;
};

class SshTunnel {
public:
    SshTunnel();
    ~SshTunnel();

    SshTunnel(const SshTunnel&) = delete;
    SshTunnel& operator=(const SshTunnel&) = delete;
    SshTunnel(SshTunnel&&) noexcept;
    SshTunnel& operator=(SshTunnel&&) noexcept;

    // Establish SSH connection and create tunnel
    [[nodiscard]] std::expected<void, SshTunnelError> connect(const SshTunnelConfig& config);

    // Close the tunnel and SSH connection
    void disconnect();

    // Check if tunnel is active
    [[nodiscard]] bool isConnected() const;

    // Get local port for DB connection (localhost:localPort -> remoteHost:remotePort)
    [[nodiscard]] int getLocalPort() const;

private:
    class Impl;
    std::unique_ptr<Impl> m_impl;
};

}  // namespace predategrip

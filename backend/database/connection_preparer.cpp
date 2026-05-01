#include "connection_preparer.h"

#include "../network/ssh_tunnel.h"
#include "connection_string_builder.h"
#include "driver_interface.h"

#include <format>

namespace velocitydb {
namespace {

[[nodiscard]] SshTunnelConfig buildSshTunnelConfig(const SshConnectionParams& ssh, const std::string& server, DbType dbType) {
    auto [host, port] = splitHostPort(server, defaultDbPort(dbType));

    SshTunnelConfig config;
    config.host = ssh.host;
    config.port = ssh.port;
    config.username = ssh.username;
    config.authMethod = (ssh.authType == "privateKey") ? SshAuthMethod::PublicKey : SshAuthMethod::Password;
    config.password = ssh.password;
    config.privateKeyPath = ssh.privateKeyPath;
    config.keyPassphrase = ssh.keyPassphrase;
    config.remoteHost = std::move(host);
    config.remotePort = port;
    return config;
}

[[nodiscard]] std::expected<std::unique_ptr<SshTunnel>, std::string> establishSshTunnel(const DatabaseConnectionParams& params) {
    auto tunnel = std::make_unique<SshTunnel>();
    auto config = buildSshTunnelConfig(params.ssh, params.server, params.dbType);
    auto result = tunnel->connect(config);
    if (!result) {
        return std::unexpected(std::format("SSH tunnel failed: {}", result.error().message));
    }
    return tunnel;
}

[[nodiscard]] DriverType toDriverType(DbType dbType) noexcept {
    switch (dbType) {
        case DbType::PostgreSQL:
            return DriverType::PostgreSQL;
        case DbType::MySQL:
            return DriverType::MySQL;
        default:
            return DriverType::SQLServer;
    }
}

}  // namespace

std::expected<PreparedConnection, std::string> prepareConnection(const DatabaseConnectionParams& params) {
    DatabaseConnectionParams effectiveParams = params;
    std::unique_ptr<SshTunnel> tunnel;

    if (params.ssh.enabled) {
        auto tunnelResult = establishSshTunnel(params);
        if (!tunnelResult)
            return std::unexpected(tunnelResult.error());
        tunnel = std::move(*tunnelResult);
        effectiveParams.server = std::format("127.0.0.1,{}", tunnel->getLocalPort());
    }

    auto connStr = buildConnectionString(effectiveParams);
    if (!connStr)
        return std::unexpected(connStr.error());

    return PreparedConnection{std::move(*connStr), std::move(tunnel), toDriverType(params.dbType), effectiveParams};
}

}  // namespace velocitydb

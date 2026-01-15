-- Configuration module for the application

local M = {}

-- Default settings
M.defaults = {
  api_url = "https://api.example.com",
  timeout = 5000,
  retries = 3,
  debug = false,
}

-- Current configuration
M.config = vim.tbl_deep_extend("force", {}, M.defaults)

--- Setup function to initialize configuration
---@param opts table|nil User options to override defaults
function M.setup(opts)
  opts = opts or {}
  M.config = vim.tbl_deep_extend("force", M.defaults, opts)

  if M.config.debug then
    print("Config loaded:", vim.inspect(M.config))
  end
end

--- Get a configuration value
---@param key string The config key to retrieve
---@return any The configuration value
function M.get(key)
  return M.config[key]
end

--- Set a configuration value at runtime
---@param key string The config key
---@param value any The new value
function M.set(key, value)
  M.config[key] = value
end

--- Reset configuration to defaults
function M.reset()
  M.config = vim.tbl_deep_extend("force", {}, M.defaults)
end

return M

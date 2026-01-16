-- Isolated Neovim config for testing Claude Completion LSP
-- Run with: nvim -u /path/to/this/init.lua

-- Enable filetype detection
vim.cmd("filetype plugin on")
vim.cmd("syntax on")

-- Basic options
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.tabstop = 4
vim.opt.shiftwidth = 4
vim.opt.expandtab = true
vim.opt.completeopt = "menu,menuone,noselect"

-- Get the directory where this config lives
local config_dir = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":h")
local server_path = config_dir .. "/../server/dist/index.js"

-- Supported file extensions
local supported_extensions = {
  py = true, ts = true, tsx = true, js = true, jsx = true,
  lua = true, rs = true, go = true, java = true,
  cpp = true, c = true, rb = true, php = true,
}

-- Function to start LSP
local function start_claude_lsp()
  -- Check if already attached
  for _, client in ipairs(vim.lsp.get_clients()) do
    if client.name == "claude-completion" then
      return
    end
  end

  vim.lsp.start({
    name = "claude-completion",
    cmd = { "node", server_path },
    root_dir = vim.fn.getcwd(),
  })
  print("Claude LSP started!")
end

-- Start LSP on BufEnter for supported files
vim.api.nvim_create_autocmd("BufEnter", {
  callback = function()
    local ext = vim.fn.expand("%:e")
    if supported_extensions[ext] then
      -- Delay slightly to ensure buffer is ready
      vim.defer_fn(start_claude_lsp, 100)
    end
  end,
})

-- Also try on FileType
vim.api.nvim_create_autocmd("FileType", {
  pattern = { "python", "typescript", "javascript", "lua", "rust", "go", "java", "cpp", "c", "ruby", "php" },
  callback = function()
    vim.defer_fn(start_claude_lsp, 100)
  end,
})

-- Keybinding to trigger completion manually
vim.keymap.set("i", "<C-Space>", function()
  vim.lsp.buf.completion()
end, { desc = "Trigger completion" })

-- Manual command to start LSP
vim.api.nvim_create_user_command("ClaudeStart", start_claude_lsp, {})

print("Claude Completion LSP test config loaded")
print("Server: " .. server_path)
print("Trigger completion: <C-x><C-o> or <C-Space> in insert mode")
print("Manual start: :ClaudeStart")

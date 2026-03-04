vim.opt.nu = true
vim.opt.relativenumber = true

vim.opt.tabstop = 4
vim.opt.softtabstop = 4
vim.opt.shiftwidth = 4
vim.opt.expandtab = true

vim.opt.smartindent = true

vim.opt.wrap = false

vim.opt.swapfile = false
vim.opt.backup = false
vim.opt.undodir = os.getenv("HOME") .. "/.vim/undodir"
vim.opt.undofile = true

vim.opt.hlsearch = false
vim.opt.incsearch = true

vim.opt.termguicolors = true

vim.opt.scrolloff = 8
vim.opt.signcolumn = "yes"
vim.opt.isfname:append("@-@")

vim.opt.updatetime = 50

vim.opt.colorcolumn = "120"

-- Netrw configuration
-- Auto-select the current file when opening netrw
vim.g.netrw_fastbrowse = 0

-- Position cursor on current file in netrw
vim.api.nvim_create_autocmd("FileType", {
	pattern = "netrw",
	callback = function()
		-- Delay the search to ensure netrw has fully loaded
		vim.defer_fn(function()
			-- Get the file name we came from
			local file_name = vim.fn.expand("#:t")
			if file_name ~= "" then
				-- Search for that filename in the netrw buffer
				vim.fn.search("\\V" .. vim.fn.escape(file_name, "\\"))
			end
		end, 10)
	end,
})

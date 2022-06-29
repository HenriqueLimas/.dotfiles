local actions = require('telescope.actions')
-- require("telescope").load_extension("git_worktree")

local M = {}

M.git_branches = function()
    require("telescope.builtin").git_branches({
        attach_mappings = function(_, map)
            map('i', '<c-d>', actions.git_delete_branch)
            map('n', '<c-d>', actions.git_delete_branch)
            return true
        end
    })
end

M.find_adr = function()
    require("telescope.builtin").find_files({
        search_dirs = {"docs/architecture-decision-records"}
    })
end

M.buffers = function()
    require("telescope.builtin").buffers({
        attach_mappings = function(_, map)
            map('i', '<c-d>', actions.delete_buffer)
            map('n', '<c-d>', actions.delete_buffer)
            return true
        end
    })
end

return M

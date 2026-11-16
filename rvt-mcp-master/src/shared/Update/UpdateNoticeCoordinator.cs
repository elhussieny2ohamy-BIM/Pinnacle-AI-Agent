using System;

namespace RvtMcp.Plugin.Update
{
    /// <summary>
    /// Update notification coordinator: Disabled to prevent unprompted popup windows
    /// and GitHub notification traffic for end-users.
    /// </summary>
    public sealed class UpdateNoticeCoordinator
    {
        public UpdateNoticeCoordinator(Action<string> log)
        {
        }

        public void Start()
        {
            // Disabled: Do not query GitHub or schedule background update checks
        }

        public void OnIdling(IntPtr ownerHwnd)
        {
            // Disabled: Do not show UpdateNoticeWindow popup in Revit UI
        }

        public void Shutdown()
        {
        }
    }
}


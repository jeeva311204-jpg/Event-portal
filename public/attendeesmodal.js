import React, { useState, useEffect } from 'react';

export default function AttendeesModal({ eventId, eventTitle, onClose }) {
  const [attendees, setAttendees] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function getAttendees() {
      try {
        const response = await fetch(`/api/events/${eventId}/attendees`);
        const data = await response.json();
        setAttendees(data.attendees || []);
      } catch (err) {
        console.error("Error loading attendees:", err);
      } finally {
        setLoading(false);
      }
    }
    getAttendees();
  }, [eventId]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 border border-slate-700 text-white rounded-xl w-full max-w-lg p-6 shadow-2xl">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4">
          <div>
            <h3 className="text-xl font-bold text-amber-400">{eventTitle}</h3>
            <p className="text-xs text-slate-400">Total Registered: {attendees.length}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white font-bold text-lg">✕</button>
        </div>

        {loading ? (
          <p className="text-center py-6 text-slate-400">Loading registrations...</p>
        ) : attendees.length === 0 ? (
          <p className="text-center py-6 text-slate-500">No users registered for this event yet.</p>
        ) : (
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="pb-2">#</th>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {attendees.map((user, idx) => (
                  <tr key={user._id || idx} className="hover:bg-slate-800/40">
                    <td className="py-2 text-slate-500">{idx + 1}</td>
                    <td className="py-2 text-slate-200">{user.name || 'Student'}</td>
                    <td className="py-2 text-amber-300">{user.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 text-right">
          <button onClick={onClose} className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-md text-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
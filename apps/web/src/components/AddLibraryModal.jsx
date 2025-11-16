import LibraryForm from './LibraryForm.jsx';

export default function AddLibraryModal({ isOpen, onClose, onSubmit }) {
  const handleSubmit = async payload => {
    await onSubmit(payload);
    onClose();
  };

  return (
    <div className="modal-wrapper">
      {isOpen && (
        <div className="modal-overlay" onClick={onClose}>
          <div className="modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Add library</h2>
              <button className="close" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>
            <LibraryForm onSubmit={handleSubmit} inlineHeading={false} />
          </div>
        </div>
      )}
    </div>
  );
}

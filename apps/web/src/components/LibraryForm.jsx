import { useState } from 'react';

const INITIAL_STATE = {
  name: '',
  ecosystem: '',
  description: '',
  repository_url: ''
};

export default function LibraryForm({ onSubmit, inlineHeading = true }) {
  const [form, setForm] = useState(INITIAL_STATE);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await onSubmit(form);
    setForm(INITIAL_STATE);
  };

  return (
    <form className="panel" onSubmit={handleSubmit}>
      {inlineHeading && <h2>Add library</h2>}
      <div className="form-grid">
        <label>
          Name
          <input name="name" value={form.name} onChange={handleChange} required />
        </label>
        <label>
          Ecosystem
          <input name="ecosystem" value={form.ecosystem} onChange={handleChange} required />
        </label>
        <label>
          Description
          <input name="description" value={form.description} onChange={handleChange} />
        </label>
        <label>
          Repository URL
          <input name="repository_url" value={form.repository_url} onChange={handleChange} />
        </label>
      </div>
      <button type="submit">Create</button>
    </form>
  );
}
